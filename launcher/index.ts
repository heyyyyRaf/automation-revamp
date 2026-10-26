/**
 * Sandbox launcher service (docker compose: `launcher`).
 *
 * The only component with Docker API access (through a docker-socket-proxy). It accepts a
 * validated RunnerInput and starts ONE fresh runner container per session with fixed, hardened
 * settings that callers cannot change: non-root, read-only root filesystem, tmpfs scratch space,
 * all capabilities dropped, no-new-privileges, CPU/memory/PID limits, a hard timeout, and an
 * internal-only network whose sole exit is the egress proxy. No mounts, no secrets in env.
 */
import http from "node:http";
import { z } from "zod";
import { checkControlToken } from "@/server/egress/proxy";
import { logger } from "@/server/logger";
import { runnerInputSchema } from "@/server/sandbox/protocol";
import { demultiplex, DockerClient, dockerTargetFromEnv } from "./docker";

const log = logger.child({ service: "launcher" });
const TOKEN = process.env.LAUNCHER_TOKEN ?? "";
const IMAGE = process.env.RUNNER_IMAGE ?? "traxion-qa-runner:latest";
const NETWORK = process.env.SANDBOX_NETWORK ?? "traxion-qa_sandbox";
const MAX_CONCURRENT = Number(process.env.LAUNCHER_MAX_CONCURRENT ?? "2");
if (TOKEN.length < 16) {
  log.fatal("LAUNCHER_TOKEN must be set (min 16 chars)");
  process.exit(1);
}

const docker = new DockerClient(dockerTargetFromEnv());
const sessions = new Map<string, { containerId: string; stdin: NodeJS.WritableStream }>();

const startSchema = z.object({
  runId: z.string().regex(/^[a-z0-9-]{8,64}$/),
  timeoutSeconds: z.number().int().min(10).max(14_400),
  input: runnerInputSchema,
});

function containerSpec(runId: string) {
  return {
    Image: IMAGE,
    Cmd: ["node", "/opt/runner/dist/runner/entry.mjs"],
    User: "pwuser",
    WorkingDir: "/tmp",
    Env: ["HOME=/tmp", "PLAYWRIGHT_BROWSERS_PATH=/ms-playwright", "NODE_ENV=production"],
    OpenStdin: true,
    StdinOnce: false,
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
    Labels: { "traxion.run": runId },
    HostConfig: {
      NetworkMode: NETWORK,
      ReadonlyRootfs: true,
      Tmpfs: { "/tmp": "rw,nosuid,nodev,size=1g", "/dev/shm": "rw,nosuid,nodev,size=512m" },
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges:true"],
      Privileged: false,
      Memory: 2 * 1024 ** 3,
      MemorySwap: 2 * 1024 ** 3,
      NanoCpus: 2_000_000_000,
      PidsLimit: 512,
      Init: true,
      Ulimits: [{ Name: "nofile", Soft: 4096, Hard: 4096 }],
      AutoRemove: false,
    },
  };
}

async function removeContainer(id: string): Promise<void> {
  await docker
    .json("DELETE", `/containers/${encodeURIComponent(id)}?force=1`)
    .catch(() => undefined);
}

/** Crash recovery: remove runner containers left over from a previous launcher process. */
async function removeStale(): Promise<void> {
  const filters = encodeURIComponent(JSON.stringify({ label: ["traxion.run"] }));
  const { data } = await docker.json<{ Id: string }[]>(
    "GET",
    `/containers/json?all=1&filters=${filters}`,
  );
  for (const c of data) await removeContainer(c.Id);
  if (data.length) log.warn({ removed: data.length }, "removed stale runner containers");
}

function readBody(req: http.IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c: Buffer) => {
      body += c.toString("utf8");
      if (body.length > limit) {
        reject(new Error("too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function startSession(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (sessions.size >= MAX_CONCURRENT) {
    res.writeHead(429).end();
    return;
  }
  const { runId, timeoutSeconds, input } = startSchema.parse(
    JSON.parse(await readBody(req, 12_000_000)),
  );
  if (sessions.has(runId)) {
    res.writeHead(409).end();
    return;
  }

  const { data } = await docker.json<{ Id: string }>(
    "POST",
    `/containers/create?name=tqa-${runId}`,
    containerSpec(runId),
  );
  const id = data.Id;
  const stream = await docker.attach(id);
  sessions.set(runId, { containerId: id, stdin: stream });
  res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store" });

  let finished = false;
  const finish = async (code: number | null) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    sessions.delete(runId);
    res.end(`${JSON.stringify({ t: "exit", code })}\n`);
    await removeContainer(id);
  };

  stream.on(
    "data",
    demultiplex(
      (chunk) => res.write(chunk),
      (chunk) =>
        log.debug({ runId, stderr: chunk.toString("utf8").slice(0, 500) }, "runner stderr"),
    ),
  );
  const timer = setTimeout(() => {
    log.warn({ runId }, "run timed out; killing container");
    void docker.json("POST", `/containers/${id}/kill`).catch(() => undefined);
  }, timeoutSeconds * 1000);
  // The worker went away: stop the run.
  res.on("close", () => {
    if (!finished) void docker.json("POST", `/containers/${id}/kill`).catch(() => undefined);
  });

  await docker.json("POST", `/containers/${id}/start`);
  stream.write(`${JSON.stringify(input)}\n`);
  const waited = await docker
    .json<{ StatusCode: number }>("POST", `/containers/${id}/wait`)
    .catch(() => ({ data: { StatusCode: null } }));
  await finish(waited.data.StatusCode ?? null);
}

async function control(runId: string, req: http.IncomingMessage, res: http.ServerResponse) {
  const { command } = z
    .object({ command: z.enum(["pause", "resume", "stop"]) })
    .parse(JSON.parse(await readBody(req, 1000)));
  const session = sessions.get(runId);
  if (!session) {
    res.writeHead(404).end();
    return;
  }
  session.stdin.write(`${command}\n`);
  if (command === "stop") {
    setTimeout(() => {
      if (sessions.has(runId))
        void docker.json("POST", `/containers/${session.containerId}/kill`).catch(() => undefined);
    }, 10_000).unref();
  }
  res.writeHead(204).end();
}

http
  .createServer((req, res) => {
    if (!checkControlToken(req.headers.authorization, TOKEN)) {
      res.writeHead(401).end();
      return;
    }
    const m = /^\/v1\/sessions(?:\/([a-z0-9-]{8,64})\/control)?$/.exec(req.url ?? "");
    const handler =
      req.method === "POST" && m && !m[1]
        ? startSession(req, res)
        : req.method === "POST" && m?.[1]
          ? control(m[1], req, res)
          : Promise.resolve(void res.writeHead(404).end());
    handler.catch((err: unknown) => {
      log.error({ err }, "launcher request failed");
      if (!res.headersSent) res.writeHead(400);
      res.end();
    });
  })
  .listen(4000, "0.0.0.0", () => {
    log.info({ image: IMAGE, network: NETWORK }, "launcher listening on :4000");
    removeStale().catch((err: unknown) => log.error({ err }, "stale cleanup failed"));
  });
