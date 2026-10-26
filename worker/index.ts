import { UnrecoverableError, Worker } from "bullmq";
import type { JobType } from "@/generated/prisma/client";
import { getEnv } from "@/server/env";
import { db } from "@/server/db";
import { purgeExpiredSessions } from "@/server/auth/session";
import { QUEUES } from "@/server/jobs/dispatcher";
import { JOB_HANDLERS, timeoutMsFor } from "@/server/jobs/handlers";
import { reapStuckJobs } from "@/server/jobs/reaper";
import { runTrackedJob } from "@/server/jobs/runner";
import { createRedis } from "@/server/queue/connection";
import { logger } from "@/server/logger";

const env = getEnv();
const log = logger.child({ service: "worker" });

/**
 * Concurrency per queue: AI calls are slow and costly, so few at a time. Each run itself
 * uses up to 5 parallel browser sandboxes (NFR-8).
 */
const CONCURRENCY: Record<(typeof QUEUES)[number], number> = {
  documents: 2,
  ai: 2,
  exports: 2,
  browser: 2,
  runs: 2,
};

const workers = QUEUES.map((queue) => {
  const worker = new Worker<{ jobId: string }>(
    queue,
    async (bullJob) => {
      const type = bullJob.name as JobType;
      const result = await runTrackedJob({
        jobId: bullJob.data.jobId,
        attempt: bullJob.attemptsMade + 1,
        handlers: JOB_HANDLERS,
        timeoutMs: timeoutMsFor(type),
        log: log.child({ jobId: bullJob.data.jobId, type, queue }),
      });
      if (result.outcome === "retry") throw new Error(result.message);
      if (result.outcome === "failed") throw new UnrecoverableError(result.message);
    },
    {
      connection: createRedis({ forWorker: true }),
      concurrency: CONCURRENCY[queue],
      lockDuration: 60_000,
      maxStalledCount: 2,
    },
  );
  worker.on("error", (err) => log.error({ err, queue }, "worker error"));
  return worker;
});

const maintenance = setInterval(() => {
  void (async () => {
    try {
      await reapStuckJobs(log);
      await purgeExpiredSessions();
    } catch (err) {
      log.error({ err }, "maintenance failed");
    }
  })();
}, 60_000);

log.info({ queues: QUEUES, aiProvider: env.AI_PROVIDER }, "worker started");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "worker shutting down");
  clearInterval(maintenance);
  // Finish in-flight jobs (bounded by their own timeout), then disconnect.
  await Promise.all(workers.map((w) => w.close()));
  await db.$disconnect();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (err) => log.error({ err }, "unhandled rejection"));
