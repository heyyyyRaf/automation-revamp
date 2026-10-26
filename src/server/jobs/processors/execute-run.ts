import { z } from "zod";
import type { TestResultStatus } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { getEnv } from "@/server/env";
import { AppError } from "@/server/errors";
import { JobFailure, type JobHandler } from "@/server/jobs/runner";
import { logger } from "@/server/logger";
import { getRunBus, type LiveEvent, type RunControl } from "@/server/runs/bus";
import { FINAL_RUN, finishRun, startFailureAnalysis } from "@/server/runs/finish";
import type { RunnerEvent } from "@/server/sandbox/protocol";
import { runInSandbox, type SandboxSession } from "@/server/sandbox/sandbox";
import { grantedOrigins, loadEnvironmentSecrets } from "@/server/services/environments";
import { getStorage, newObjectKey } from "@/server/storage/storage";

const payloadSchema = z.object({ runId: z.string().min(1) });

/** NFR-8: at least 5 parallel test workers. */
export const MAX_PARALLEL = 5;
/** Step screenshots kept per test ("click a step to see the page as it was"). */
const MAX_STEP_SHOTS = 40;
const MAX_LINES = 500;

const RESULT: Record<string, TestResultStatus> = {
  passed: "PASSED",
  failed: "FAILED",
  // FR-8.4: a timed-out case is marked Error, not left hanging.
  timedOut: "ERROR",
  interrupted: "ERROR",
  skipped: "SKIPPED",
};

interface TestState {
  stepIndex: number;
  shots: number;
  lastFrame: string | null;
  logs: string[];
  console: { level: string; text: string }[];
  network: {
    method: string;
    url: string;
    status: number | null;
    durationMs: number | null;
    failed: boolean;
  }[];
  artifacts: Map<string, string[]>;
  done: boolean;
}

/** "Click getByRole('button', …)" → "click"; "Expect toBeVisible" → "expect". */
function actionOf(title: string, category: string): string | null {
  if (category === "expect") return "expect";
  if (category === "test.step") return null;
  const word = /^([A-Za-z]+)/.exec(title)?.[1];
  return word ? word.toLowerCase() : null;
}

/**
 * FRD step 6: runs the approved scripts in fresh sandboxes, up to five at a time, streaming
 * per-case status to the Live Run view and saving screenshots, console logs, network logs
 * and traces. Timeouts become Error; a crash aborts the run and keeps finished results.
 */
export const executeRunHandler: JobHandler = async ({ job, signal }) => {
  const payload = payloadSchema.safeParse(job.payload);
  if (!payload.success) throw new JobFailure("This job has invalid settings.", false);
  const run = await db.run.findFirst({
    where: { id: payload.data.runId, projectId: job.projectId },
    include: {
      environment: true,
      tests: { include: { scriptVersion: { select: { code: true } } }, orderBy: { id: "asc" } },
    },
  });
  if (!run) throw new JobFailure("This run no longer exists.", false);
  if (FINAL_RUN.includes(run.status)) return { skipped: true };

  const bus = getRunBus();
  const publish = (event: LiveEvent) => bus.publish(run.id, event).catch(() => undefined);

  let origins;
  try {
    origins = await grantedOrigins(run.environment);
  } catch (err) {
    const message = err instanceof AppError ? err.message : "The address is not approved.";
    await finishRun(run.id, "error", message);
    return { status: "ERROR" };
  }
  const secrets = await loadEnvironmentSecrets(run.environment);

  const workers = Math.max(1, Math.min(MAX_PARALLEL, run.tests.length));
  const chunks: (typeof run.tests)[] = Array.from({ length: workers }, () => []);
  run.tests.forEach((t, i) => chunks[i % workers]?.push(t));

  await db.run.update({
    where: { id: run.id },
    data: { status: "RUNNING", startedAt: new Date(), workers, jobId: job.id },
  });
  await publish({
    type: "run",
    status: "RUNNING",
    passed: 0,
    failed: 0,
    errors: 0,
    skipped: 0,
    error: null,
  });

  const state = new Map<string, TestState>(
    run.tests.map((t) => [
      t.id,
      {
        stepIndex: 0,
        shots: 0,
        lastFrame: null,
        logs: [],
        console: [],
        network: [],
        artifacts: new Map(),
        done: false,
      },
    ]),
  );
  const storage = getStorage();
  const keyPrefix = run.projectId;
  const sessions: SandboxSession[] = [];
  let stopped = false;
  let crashed = false;

  const stopControl = await bus.onControl(run.id, (command: RunControl) => {
    // Record a stop before telling the sessions, so the run can't finish in between.
    if (command === "stop") stopped = true;
    void (async () => {
      for (const s of sessions) await s.control(command).catch(() => undefined);
      if (command === "pause") {
        await db.run.update({
          where: { id: run.id },
          data: { status: "PAUSED", pausedAt: new Date() },
        });
        await publish({ type: "paused" });
      } else if (command === "resume") {
        await db.run.update({ where: { id: run.id }, data: { status: "RUNNING", pausedAt: null } });
        await publish({ type: "resumed" });
      } else if (command === "slow" || command === "normal") {
        await publish({ type: "speed", slow: command === "slow" });
      }
    })();
  });

  async function handle(event: RunnerEvent): Promise<void> {
    const st = "id" in event && event.id ? state.get(event.id) : undefined;
    switch (event.t) {
      case "test-begin": {
        if (!st) return;
        if (event.retry > 0) {
          // A retry starts clean: only the final attempt's steps are kept.
          await db.runStep.deleteMany({ where: { runTestId: event.id } });
          st.stepIndex = 0;
          st.shots = 0;
        }
        await db.runTest.update({
          where: { id: event.id },
          data: { status: "RUNNING", startedAt: new Date(), attempts: event.retry + 1 },
        });
        await publish({
          type: "test",
          runTestId: event.id,
          status: "RUNNING",
          durationMs: null,
          error: null,
        });
        return;
      }
      case "step-end": {
        if (!st) return;
        const index = st.stepIndex++;
        let screenshotKey: string | null = null;
        if (st.lastFrame && st.shots < MAX_STEP_SHOTS) {
          st.shots++;
          screenshotKey = newObjectKey(keyPrefix, "artifacts");
          await storage.put(screenshotKey, Buffer.from(st.lastFrame, "base64"), "image/jpeg");
        }
        const step = await db.runStep.create({
          data: {
            runTestId: event.id,
            index,
            category: event.category,
            title: event.title,
            action: actionOf(event.title, event.category),
            status: event.error ? "FAILED" : "PASSED",
            startedAt: new Date(Date.now() - event.durationMs),
            durationMs: event.durationMs,
            screenshotKey,
            error: event.error,
          },
        });
        await publish({
          type: "step",
          runTestId: event.id,
          step: {
            id: step.id,
            index,
            title: step.title,
            category: step.category,
            status: step.status,
            durationMs: step.durationMs,
            error: step.error,
            hasScreenshot: Boolean(screenshotKey),
          },
        });
        return;
      }
      case "step-begin":
        await publish({
          type: "step-begin",
          runTestId: event.id,
          title: event.title,
          category: event.category,
        });
        return;
      case "frame":
        if (st) st.lastFrame = event.jpeg;
        await publish({ type: "frame", runTestId: event.id, jpeg: event.jpeg });
        return;
      case "log":
        if (st && st.logs.length < MAX_LINES) st.logs.push(`[${event.stream}] ${event.text}`);
        await publish({ type: "log", runTestId: event.id, stream: event.stream, text: event.text });
        return;
      case "console":
        if (st && st.console.length < MAX_LINES)
          st.console.push({ level: event.level, text: event.text });
        await publish({
          type: "console",
          runTestId: event.id,
          level: event.level,
          text: event.text,
        });
        return;
      case "net": {
        const entry = {
          method: event.method,
          url: event.url,
          status: event.status,
          durationMs: event.durationMs,
          failed: event.failed,
        };
        if (st && st.network.length < MAX_LINES) st.network.push(entry);
        await publish({ type: "net", runTestId: event.id, ...entry });
        return;
      }
      case "test-end": {
        if (!st) return;
        const status = RESULT[event.status] ?? "ERROR";
        const final = status === "PASSED" || status === "SKIPPED" || event.retry >= run!.retries;
        await db.runTest.update({
          where: { id: event.id },
          data: {
            status: final ? status : "RUNNING",
            durationMs: event.durationMs,
            errorMessage:
              status === "ERROR" && event.status === "timedOut"
                ? `Timed out after ${run!.timeoutSeconds} s. ${event.error ?? ""}`.trim()
                : event.error,
          },
        });
        if (final) st.done = true;
        await publish({
          type: "test",
          runTestId: event.id,
          status: final ? status : "RUNNING",
          durationMs: event.durationMs,
          error: event.error,
        });
        return;
      }
      case "artifact": {
        if (!st) return;
        const parts = st.artifacts.get(event.kind) ?? [];
        parts.push(event.data);
        st.artifacts.set(event.kind, parts);
        if (event.last) {
          const key = newObjectKey(keyPrefix, "artifacts");
          const data = Buffer.from(parts.join(""), "base64");
          await storage.put(key, data, event.kind === "trace" ? "application/zip" : "image/png");
          await db.runTest.update({
            where: { id: event.id },
            data: event.kind === "trace" ? { traceKey: key } : { screenshotKey: key },
          });
          st.artifacts.delete(event.kind);
        }
        return;
      }
      case "paused":
      case "resumed":
        return; // already reflected by the control handler
      default:
        return;
    }
  }

  const timeoutMs = getEnv().RUN_MAX_SECONDS * 1000;
  await Promise.all(
    chunks.map(async (chunk, i) => {
      if (chunk.length === 0) return;
      let sawDone = false;
      try {
        for await (const event of runInSandbox({
          sessionId: `run-${run.id}-${i}`,
          label: `run:${run.id}:${i}`,
          origins,
          input: {
            mode: "run",
            baseURL: run.environment.baseUrl,
            storageState: secrets.storageState,
            accounts: secrets.accounts,
            vars: secrets.vars,
            testTimeoutMs: run.timeoutSeconds * 1000,
            retries: run.retries,
            slowMoMs: run.slowMoMs,
            tests: chunk.map((t) => ({ id: t.id, code: t.scriptVersion.code })),
          },
          timeoutMs,
          signal,
          onSession: (s) => sessions.push(s),
        })) {
          if (event.t === "done") sawDone = true;
          await handle(event);
        }
      } catch (err) {
        logger.warn({ err, runId: run.id, worker: i }, "run worker failed");
        crashed = true;
        return;
      }
      // A session that ended without its final report crashed (container killed, OOM…).
      if (!sawDone && !stopped) crashed = true;
    }),
  );
  await stopControl().catch(() => undefined);

  // Logs, console and network go to storage as one JSON file each per test.
  for (const [runTestId, st] of state) {
    const data: Record<string, string | null> = {};
    for (const [field, value] of [
      ["logKey", st.logs.length ? st.logs.join("\n") : null],
      ["consoleKey", st.console.length ? JSON.stringify(st.console) : null],
      ["networkKey", st.network.length ? JSON.stringify(st.network) : null],
    ] as const) {
      if (!value) continue;
      const key = newObjectKey(keyPrefix, "artifacts");
      await storage.put(
        key,
        Buffer.from(value, "utf8"),
        field === "logKey" ? "text/plain" : "application/json",
      );
      data[field] = key;
    }
    if (Object.keys(data).length) await db.runTest.update({ where: { id: runTestId }, data });
  }

  const outcome = stopped ? "cancelled" : crashed || signal.aborted ? "aborted" : "completed";
  const status = await finishRun(
    run.id,
    outcome,
    outcome === "aborted"
      ? signal.aborted
        ? "The run took too long and was stopped. Finished results are kept."
        : "A test worker stopped unexpectedly. Finished results are kept."
      : null,
  );
  // FR-9.3: explain failures in the background (skipped when the AI budget is used up).
  if (status === "FAILED" || status === "ABORTED") {
    await startFailureAnalysis(run.projectId, run.id, job.createdById).catch((err: unknown) =>
      logger.warn({ err, runId: run.id }, "failure analysis not started"),
    );
  }
  return { status, workers };
};
