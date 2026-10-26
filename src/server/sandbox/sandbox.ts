import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import type { GrantedOrigin } from "@/server/egress/proxy";
import { getEnv } from "@/server/env";
import { logger } from "@/server/logger";
import { getEgress } from "@/server/sandbox/egress";
import {
  parseEventLine,
  scrub,
  secretVariants,
  type RunnerEvent,
  type RunnerInput,
} from "@/server/sandbox/protocol";

export type ControlCommand = "pause" | "resume" | "stop" | "slow" | "normal";

export interface SandboxSession {
  events: AsyncIterable<RunnerEvent>;
  control(command: ControlCommand): Promise<void>;
}

export interface Sandbox {
  start(sessionId: string, input: RunnerInput, timeoutMs: number): Promise<SandboxSession>;
}

async function* parseLines(stream: Readable): AsyncIterable<RunnerEvent> {
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const event = parseEventLine(line);
    if (event) yield event;
  }
}

/** Production: one fresh, hardened container per session via the launcher service. */
class LauncherSandbox implements Sandbox {
  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  async start(sessionId: string, input: RunnerInput, timeoutMs: number): Promise<SandboxSession> {
    const res = await fetch(`${this.url}/v1/sessions`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify({
        runId: sessionId,
        timeoutSeconds: Math.ceil(timeoutMs / 1000),
        input,
      }),
    });
    if (res.status === 429) throw new Error("All sandboxes are busy.");
    if (!res.ok || !res.body) throw new Error(`launcher refused the session: ${res.status}`);
    const body = Readable.fromWeb(res.body as WebReadableStream<Uint8Array>);
    return {
      events: parseLines(body),
      control: async (command) => {
        await fetch(`${this.url}/v1/sessions/${sessionId}/control`, {
          method: "POST",
          headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
          body: JSON.stringify({ command }),
        }).catch(() => undefined);
      },
    };
  }
}

/**
 * Development/test only: runs the runner as a local child process. NOT a sandbox — it is
 * refused when NODE_ENV=production. It still gets no server secrets in its environment and
 * still goes through the egress proxy.
 */
class LocalSandbox implements Sandbox {
  constructor(private readonly entry: string) {}

  async start(_sessionId: string, input: RunnerInput, timeoutMs: number): Promise<SandboxSession> {
    const keep = [
      "PATH",
      "Path",
      "HOME",
      "USERPROFILE",
      "TEMP",
      "TMP",
      "SystemRoot",
      "windir",
      "PLAYWRIGHT_BROWSERS_PATH",
    ];
    const env: NodeJS.ProcessEnv = { NODE_ENV: "development" };
    for (const k of keep) if (process.env[k]) env[k] = process.env[k];
    const child = spawn(process.execPath, [this.entry], { env, stdio: ["pipe", "pipe", "pipe"] });
    child.stderr.on("data", (c: Buffer) =>
      logger.debug({ stderr: c.toString().slice(0, 500) }, "local runner"),
    );
    child.stdin.write(`${JSON.stringify(input)}\n`);
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    const exit = new Promise<number | null>((resolve) =>
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve(code);
      }),
    );
    async function* events(): AsyncIterable<RunnerEvent> {
      yield* parseLines(child.stdout);
      yield { t: "exit", code: await exit };
    }
    return {
      events: events(),
      control: async (command) => {
        if (!child.stdin.destroyed) child.stdin.write(`${command}\n`);
        if (command === "stop") setTimeout(() => child.kill("SIGKILL"), 10_000).unref();
      },
    };
  }
}

let instance: Sandbox | undefined;

export function localRunnerEntry(): string {
  return join(process.cwd(), "dist", "runner", "entry.mjs");
}

export function getSandbox(): Sandbox {
  if (instance) return instance;
  const env = getEnv();
  if (env.SANDBOX_MODE === "local") {
    if (env.NODE_ENV === "production") {
      throw new Error(
        "SANDBOX_MODE=local is not allowed in production: scripts must run in containers.",
      );
    }
    const entry = localRunnerEntry();
    if (!existsSync(entry)) throw new Error("Runner not built. Run `npm run build:worker` first.");
    instance = new LocalSandbox(entry);
  } else {
    if (!env.LAUNCHER_URL || !env.LAUNCHER_TOKEN)
      throw new Error("Sandbox launcher is not configured.");
    instance = new LauncherSandbox(env.LAUNCHER_URL, env.LAUNCHER_TOKEN);
  }
  return instance;
}

/** Tests only. */
export function setSandbox(s: Sandbox | undefined): void {
  instance = s;
}

export interface SandboxRun {
  sessionId: string;
  label: string;
  origins: GrantedOrigin[];
  input: Omit<RunnerInput, "proxy">;
  timeoutMs: number;
  /** Extra values to scrub (in addition to account credentials). */
  secrets?: string[];
  signal?: AbortSignal;
  onSession?: (session: SandboxSession) => void;
}

/**
 * Runs one sandbox session: grants egress to exactly the approved origins, streams validated
 * events with secrets scrubbed (again — never trust the sandbox to do it), and always revokes
 * the grant afterwards.
 */
export async function* runInSandbox(run: SandboxRun): AsyncIterable<RunnerEvent> {
  const grant = await getEgress().grant(
    run.label,
    run.origins,
    Math.ceil(run.timeoutMs / 1000) + 60,
  );
  const variants = secretVariants([
    ...Object.values(run.input.accounts).flatMap((a) => [a.password, a.username]),
    grant.proxy.password,
    ...(run.secrets ?? []),
  ]);
  try {
    const session = await getSandbox().start(
      run.sessionId,
      { ...run.input, proxy: grant.proxy },
      run.timeoutMs,
    );
    run.onSession?.(session);
    const onAbort = () => void session.control("stop");
    run.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      for await (const event of session.events) yield scrubEvent(event, variants);
    } finally {
      run.signal?.removeEventListener("abort", onAbort);
    }
  } finally {
    await grant.revoke();
  }
}

function scrubEvent(event: RunnerEvent, variants: string[]): RunnerEvent {
  switch (event.t) {
    case "step-begin":
      return { ...event, title: scrub(event.title, variants) };
    case "step-end":
      return {
        ...event,
        title: scrub(event.title, variants),
        error: event.error && scrub(event.error, variants),
      };
    case "log":
    case "console":
      return { ...event, text: scrub(event.text, variants) };
    case "net":
      return { ...event, url: scrub(event.url, variants) };
    case "test-end":
    case "done":
      return { ...event, error: event.error && scrub(event.error, variants) };
    case "login":
      return { ...event, error: event.error && scrub(event.error, variants) };
    case "capture":
      return {
        ...event,
        snapshot: {
          ...event.snapshot,
          aria: scrub(event.snapshot.aria, variants),
          elements: event.snapshot.elements.map((e) => ({
            ...e,
            name: e.name && scrub(e.name, variants),
            label: e.label && scrub(e.label, variants),
            text: e.text && scrub(e.text, variants),
            placeholder: e.placeholder && scrub(e.placeholder, variants),
          })),
        },
      };
    default:
      return event;
  }
}
