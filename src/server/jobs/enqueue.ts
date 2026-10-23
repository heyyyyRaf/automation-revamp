import type { Job, JobType, Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { getDispatcher } from "@/server/jobs/dispatcher";
import { onFinalFailure } from "@/server/jobs/final-failure";
import { logger } from "@/server/logger";

export const QUEUE_UNAVAILABLE_MESSAGE =
  "The background service is unavailable right now. Your file is saved — use “Try again” in a minute.";

/**
 * Creates the Job row first, then hands it to the queue. If the queue is down the row is
 * marked FAILED with a friendly message (never left QUEUED forever) and saved work is untouched.
 */
export async function enqueueJob(input: {
  projectId: string;
  type: JobType;
  payload: Prisma.InputJsonObject;
  createdById?: string;
  maxAttempts?: number;
}): Promise<Job> {
  const maxAttempts = input.maxAttempts ?? 3;
  const job = await db.job.create({
    data: {
      projectId: input.projectId,
      type: input.type,
      payload: input.payload,
      createdById: input.createdById ?? null,
      maxAttempts,
    },
  });
  try {
    await getDispatcher().dispatch({
      jobId: job.id,
      type: job.type,
      payload: input.payload as Record<string, unknown>,
      attempts: maxAttempts,
    });
    return job;
  } catch (err) {
    logger.error({ err, jobId: job.id, type: job.type }, "failed to dispatch job");
    const failed = await db.job.update({
      where: { id: job.id },
      data: { status: "FAILED", error: QUEUE_UNAVAILABLE_MESSAGE, finishedAt: new Date() },
    });
    await onFinalFailure(failed, QUEUE_UNAVAILABLE_MESSAGE);
    return failed;
  }
}
