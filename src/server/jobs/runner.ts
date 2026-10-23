import type { Job, JobType, Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { onFinalFailure } from "@/server/jobs/final-failure";
import type { Logger } from "@/server/logger";

/** Throw from a handler with a user-safe message. `retryable: false` = retrying cannot help (bad input). */
export class JobFailure extends Error {
  constructor(
    readonly userMessage: string,
    readonly retryable: boolean,
  ) {
    super(userMessage);
    this.name = "JobFailure";
  }
}

export interface JobHandlerContext {
  job: Job;
  signal: AbortSignal;
  log: Logger;
}

export type JobHandler = (ctx: JobHandlerContext) => Promise<Prisma.InputJsonValue | undefined>;

export type JobOutcome =
  | { outcome: "succeeded" }
  | { outcome: "skipped" }
  | { outcome: "retry"; message: string }
  | { outcome: "failed"; message: string };

export const TIMEOUT_MESSAGE = "This took too long and was stopped.";
export const UNEXPECTED_MESSAGE = "Processing failed unexpectedly.";
/** Extra time past the handler timeout before the reaper considers a RUNNING job stuck. */
export const REAPER_GRACE_MS = 60_000;

/**
 * Runs one attempt of a tracked job: RUNNING → SUCCEEDED, or back to QUEUED (will retry),
 * or FAILED (final). Every path ends in a saved state; nothing is left RUNNING.
 */
export async function runTrackedJob(opts: {
  jobId: string;
  attempt: number; // 1-based
  handlers: Partial<Record<JobType, JobHandler>>;
  timeoutMs: number;
  log: Logger;
}): Promise<JobOutcome> {
  const { jobId, attempt, handlers, timeoutMs, log } = opts;
  const job = await db.job.findUnique({ where: { id: jobId } });
  if (!job || job.status === "SUCCEEDED" || job.status === "CANCELLED" || job.status === "FAILED") {
    return { outcome: "skipped" };
  }
  const handler = handlers[job.type];
  if (!handler) {
    await finish(job, "FAILED", { error: UNEXPECTED_MESSAGE });
    await onFinalFailure(job, UNEXPECTED_MESSAGE);
    return { outcome: "failed", message: UNEXPECTED_MESSAGE };
  }

  const now = Date.now();
  const running = await db.job.update({
    where: { id: job.id },
    data: {
      status: "RUNNING",
      attempts: attempt,
      startedAt: job.startedAt ?? new Date(now),
      timeoutAt: new Date(now + timeoutMs + REAPER_GRACE_MS),
      error: null,
    },
  });

  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new JobFailure(TIMEOUT_MESSAGE, true));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([
      handler({ job: running, signal: controller.signal, log }),
      timeout,
    ]);
    await finish(running, "SUCCEEDED", { result: result ?? undefined, progress: 100 });
    return { outcome: "succeeded" };
  } catch (err) {
    const failure = err instanceof JobFailure ? err : new JobFailure(UNEXPECTED_MESSAGE, true);
    if (!(err instanceof JobFailure)) log.error({ err, jobId }, "job handler crashed");
    else log.warn({ jobId, message: failure.userMessage }, "job attempt failed");

    const final = !failure.retryable || attempt >= running.maxAttempts;
    if (final) {
      await finish(running, "FAILED", { error: failure.userMessage });
      await onFinalFailure(running, failure.userMessage);
      return { outcome: "failed", message: failure.userMessage };
    }
    await db.job.update({
      where: { id: running.id },
      data: { status: "QUEUED", error: `${failure.userMessage} Retrying…`, timeoutAt: null },
    });
    return { outcome: "retry", message: failure.userMessage };
  } finally {
    clearTimeout(timer);
  }
}

async function finish(
  job: Job,
  status: "SUCCEEDED" | "FAILED",
  data: { result?: Prisma.InputJsonValue | undefined; error?: string; progress?: number },
): Promise<void> {
  await db.job.update({
    where: { id: job.id },
    data: {
      status,
      finishedAt: new Date(),
      timeoutAt: null,
      ...(data.result !== undefined ? { result: data.result } : {}),
      ...(data.error !== undefined ? { error: data.error } : {}),
      ...(data.progress !== undefined ? { progress: data.progress } : {}),
    },
  });
}
