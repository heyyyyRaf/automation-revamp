import type { Job, JobType } from "@/generated/prisma/client";
import type { AuthContext } from "@/server/auth/session";
import { requireProjectAccess } from "@/server/authz/guards";
import { getAiBudget } from "@/server/ai/budget";
import { db } from "@/server/db";
import { conflict } from "@/server/errors";
import { enqueueJob } from "@/server/jobs/enqueue";
import { audit } from "@/server/services/audit";

interface Meta {
  ip: string;
  requestId: string;
}

export const JOB_PUBLIC_SELECT = {
  id: true,
  type: true,
  status: true,
  progress: true,
  attempts: true,
  maxAttempts: true,
  error: true,
  result: true,
  createdAt: true,
  startedAt: true,
  finishedAt: true,
} as const;

/** One analysis / generation at a time per project, so results never interleave. */
async function assertNotRunning(projectId: string, type: JobType): Promise<void> {
  const active = await db.job.findFirst({
    where: { projectId, type, status: { in: ["QUEUED", "RUNNING"] } },
  });
  if (active) {
    throw conflict(
      type === "ANALYZE_REQUIREMENTS"
        ? "An analysis is already running for this project. Please wait for it to finish."
        : "Test case generation is already running for this project. Please wait for it to finish.",
    );
  }
}

async function assertBudgetLeft(projectId: string): Promise<void> {
  const budget = await getAiBudget(projectId);
  if (budget.remaining <= 0) {
    throw conflict("This project has used its monthly AI limit. Ask an Admin to raise it.");
  }
}

export async function startAnalysis(
  auth: AuthContext,
  projectId: string,
  meta: Meta,
): Promise<Job> {
  await requireProjectAccess(auth, projectId, "ai:run");
  await assertNotRunning(projectId, "ANALYZE_REQUIREMENTS");
  await assertBudgetLeft(projectId);
  const job = await enqueueJob({
    projectId,
    type: "ANALYZE_REQUIREMENTS",
    payload: {},
    createdById: auth.user.id,
    // AI calls cost money: retry once at most.
    maxAttempts: 2,
  });
  await audit({
    action: "ai.analyze_requested",
    entityType: "job",
    entityId: job.id,
    projectId,
    actorId: auth.user.id,
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });
  return job;
}

export async function startGeneration(
  auth: AuthContext,
  projectId: string,
  requirementIds: string[] | undefined,
  meta: Meta,
): Promise<Job> {
  await requireProjectAccess(auth, projectId, "ai:run");
  await assertNotRunning(projectId, "GENERATE_TEST_CASES");
  await assertBudgetLeft(projectId);
  if (requirementIds?.length) {
    // Only requirements of this project may be referenced.
    const count = await db.requirement.count({
      where: { id: { in: requirementIds }, projectId, deletedAt: null },
    });
    if (count !== new Set(requirementIds).size)
      throw conflict("Some selected requirements no longer exist.");
  }
  const job = await enqueueJob({
    projectId,
    type: "GENERATE_TEST_CASES",
    payload: requirementIds?.length ? { requirementIds } : {},
    createdById: auth.user.id,
    maxAttempts: 2,
  });
  await audit({
    action: "ai.generate_requested",
    entityType: "job",
    entityId: job.id,
    projectId,
    actorId: auth.user.id,
    metadata: { requirements: requirementIds?.length ?? "all uncovered" },
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });
  return job;
}

/** Latest job of each requested type, for progress display. */
export async function latestJobs(auth: AuthContext, projectId: string, types: JobType[]) {
  await requireProjectAccess(auth, projectId, "projects:read");
  const jobs = await Promise.all(
    types.map((type) =>
      db.job.findFirst({
        where: { projectId, type },
        orderBy: { createdAt: "desc" },
        select: JOB_PUBLIC_SELECT,
      }),
    ),
  );
  return jobs.filter((j) => j !== null);
}

export async function aiBudget(auth: AuthContext, projectId: string) {
  await requireProjectAccess(auth, projectId, "projects:read");
  return getAiBudget(projectId);
}
