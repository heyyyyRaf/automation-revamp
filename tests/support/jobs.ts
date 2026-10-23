import type { JobType } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { JOB_HANDLERS } from "@/server/jobs/handlers";
import { runTrackedJob, type JobOutcome } from "@/server/jobs/runner";
import { createLogger } from "@/server/logger";

const log = createLogger({ level: "silent" });

/** Runs one attempt of a queued job in-process, exactly as the worker would. */
export function runJob(jobId: string, attempt = 1): Promise<JobOutcome> {
  return runTrackedJob({ jobId, attempt, handlers: JOB_HANDLERS, timeoutMs: 60_000, log });
}

/** Runs every still-QUEUED job of one type for a project, oldest first. */
export async function runQueued(projectId: string, type: JobType): Promise<JobOutcome[]> {
  const jobs = await db.job.findMany({
    where: { projectId, type, status: "QUEUED" },
    orderBy: { createdAt: "asc" },
  });
  const outcomes: JobOutcome[] = [];
  for (const j of jobs) outcomes.push(await runJob(j.id));
  return outcomes;
}
