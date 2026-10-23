import { db } from "@/server/db";
import { onFinalFailure } from "@/server/jobs/final-failure";
import { TIMEOUT_MESSAGE } from "@/server/jobs/runner";
import type { Logger } from "@/server/logger";

/** A job that never left the queue for this long is considered lost. */
export const MAX_QUEUED_MS = 6 * 60 * 60 * 1000;
export const LOST_MESSAGE = "This job never started. Please try again.";

/**
 * Safety net for crashed workers: marks RUNNING jobs past their deadline and QUEUED jobs
 * that were never picked up as FAILED, so nothing can hang forever.
 */
export async function reapStuckJobs(log: Logger, now = new Date()): Promise<number> {
  const stuck = await db.job.findMany({
    where: {
      OR: [
        { status: "RUNNING", timeoutAt: { lt: now } },
        { status: "QUEUED", createdAt: { lt: new Date(now.getTime() - MAX_QUEUED_MS) } },
      ],
    },
    take: 200,
  });

  let reaped = 0;
  for (const job of stuck) {
    const message = job.status === "RUNNING" ? TIMEOUT_MESSAGE : LOST_MESSAGE;
    // Conditional update: skip if the worker finished it in the meantime.
    const { count } = await db.job.updateMany({
      where: { id: job.id, status: job.status },
      data: { status: "FAILED", error: message, finishedAt: now, timeoutAt: null },
    });
    if (count === 1) {
      await onFinalFailure(job, message);
      reaped++;
    }
  }
  if (reaped > 0) log.warn({ reaped }, "reaped stuck jobs");
  return reaped;
}
