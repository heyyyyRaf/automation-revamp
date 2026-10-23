import { UnrecoverableError, Worker } from "bullmq";
import { getEnv } from "@/server/env";
import { db } from "@/server/db";
import { purgeExpiredSessions } from "@/server/auth/session";
import { JOB_HANDLERS } from "@/server/jobs/handlers";
import { reapStuckJobs } from "@/server/jobs/reaper";
import { runTrackedJob } from "@/server/jobs/runner";
import { createRedis } from "@/server/queue/connection";
import { logger } from "@/server/logger";

const env = getEnv();
const log = logger.child({ service: "worker" });
const timeoutMs = env.JOB_TIMEOUT_SECONDS * 1000;

const worker = new Worker<{ jobId: string }>(
  "documents",
  async (bullJob) => {
    const result = await runTrackedJob({
      jobId: bullJob.data.jobId,
      attempt: bullJob.attemptsMade + 1,
      handlers: JOB_HANDLERS,
      timeoutMs,
      log: log.child({ jobId: bullJob.data.jobId, type: bullJob.name }),
    });
    if (result.outcome === "retry") throw new Error(result.message);
    if (result.outcome === "failed") throw new UnrecoverableError(result.message);
  },
  {
    connection: createRedis({ forWorker: true }),
    concurrency: 2,
    // Lock must outlive the slowest step between BullMQ lock renewals.
    lockDuration: 60_000,
    maxStalledCount: 2,
  },
);

worker.on("error", (err) => log.error({ err }, "worker error"));

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

log.info({ concurrency: 2, timeoutSeconds: env.JOB_TIMEOUT_SECONDS }, "worker started");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "worker shutting down");
  clearInterval(maintenance);
  // Finish in-flight jobs (bounded by their own timeout), then disconnect.
  await worker.close();
  await db.$disconnect();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (err) => log.error({ err }, "unhandled rejection"));
