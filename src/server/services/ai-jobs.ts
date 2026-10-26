import type { Job, JobType } from "@/generated/prisma/client";
import type { AuthContext } from "@/server/auth/session";
import { requireProjectAccess } from "@/server/authz/guards";
import { getAiBudget } from "@/server/ai/budget";
import { db } from "@/server/db";
import { conflict, notFound } from "@/server/errors";
import { enqueueJob } from "@/server/jobs/enqueue";
import { audit } from "@/server/services/audit";
import { assertBudgetLeft, assertNotRunning } from "@/server/services/job-guards";
import { isValidId } from "@/server/authz/guards";
import { rewriteOutputSchema } from "@/server/ai/tasks/generation";
import { updateTestCase, type TestCaseDto } from "@/server/services/test-cases";

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

/** Analysis reads extracted text, so every file must have been read first. */
async function assertFilesRead(projectId: string): Promise<void> {
  const reading = await db.document.count({
    where: { projectId, deletedAt: null, extractionStatus: { in: ["PENDING", "PROCESSING"] } },
  });
  if (reading > 0) {
    throw conflict(
      `${reading} file${reading > 1 ? "s are" : " is"} still being read. Start the analysis when every file shows Read.`,
    );
  }
}

export async function startAnalysis(
  auth: AuthContext,
  projectId: string,
  meta: Meta,
  options: { only?: { documentId: string; part: number }[] } = {},
): Promise<Job> {
  await requireProjectAccess(auth, projectId, "ai:run");
  await assertNotRunning(projectId, "ANALYZE_REQUIREMENTS");
  await assertBudgetLeft(projectId);
  await assertFilesRead(projectId);
  const job = await enqueueJob({
    projectId,
    type: "ANALYZE_REQUIREMENTS",
    payload: options.only ? { only: options.only } : {},
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
  options: { regenerateIds?: string[] } = {},
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
    payload: options.regenerateIds?.length
      ? { regenerateIds: options.regenerateIds }
      : requirementIds?.length
        ? { requirementIds }
        : {},
    createdById: auth.user.id,
    maxAttempts: 2,
  });
  await audit({
    action: "ai.generate_requested",
    entityType: "job",
    entityId: job.id,
    projectId,
    actorId: auth.user.id,
    metadata: options.regenerateIds?.length
      ? { regenerate: options.regenerateIds.length }
      : { requirements: requirementIds?.length ?? "all uncovered" },
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });
  return job;
}

/**
 * NFR-6: re-runs only the parts of an analysis that failed. What was already found stays;
 * new findings are added (duplicates are skipped as usual).
 */
export async function retryFailedAnalysisParts(
  auth: AuthContext,
  projectId: string,
  jobId: string,
  meta: Meta,
): Promise<Job> {
  await requireProjectAccess(auth, projectId, "ai:run");
  const previous = await db.job.findFirst({
    where: { id: jobId, projectId, type: "ANALYZE_REQUIREMENTS", status: "SUCCEEDED" },
    select: { result: true },
  });
  const failed = (previous?.result as { failedChunks?: unknown } | null)?.failedChunks;
  if (!Array.isArray(failed) || failed.length === 0) {
    throw conflict("This analysis has no failed parts to retry.");
  }
  const only = failed
    .filter(
      (f): f is { documentId: string; part: number } =>
        typeof f === "object" &&
        f !== null &&
        typeof (f as { documentId?: unknown }).documentId === "string" &&
        typeof (f as { part?: unknown }).part === "number",
    )
    .map((f) => ({ documentId: f.documentId, part: f.part }));
  return startAnalysis(auth, projectId, meta, { only });
}

/** FR-4.5: write replacement cases for rejected ones, using the rejection reasons. */
export async function regenerateRejected(
  auth: AuthContext,
  projectId: string,
  testCaseIds: string[] | undefined,
  meta: Meta,
): Promise<Job> {
  await requireProjectAccess(auth, projectId, "ai:run");
  const rejected = await db.testCase.findMany({
    where: {
      projectId,
      deletedAt: null,
      status: "REJECTED",
      ...(testCaseIds?.length ? { id: { in: testCaseIds } } : {}),
    },
    select: { id: true },
    take: 200,
  });
  if (testCaseIds?.length && rejected.length !== new Set(testCaseIds).size) {
    throw conflict("Only rejected test cases can be regenerated.");
  }
  if (rejected.length === 0) throw conflict("There are no rejected test cases to regenerate.");
  return startGeneration(auth, projectId, undefined, meta, {
    regenerateIds: rejected.map((t) => t.id),
  });
}

/** Design: "Ask the assistant to rewrite this case". Produces a proposal to accept or discard. */
export async function requestRewrite(
  auth: AuthContext,
  projectId: string,
  testCaseId: string,
  instruction: string,
  meta: Meta,
): Promise<Job> {
  await requireProjectAccess(auth, projectId, "ai:run");
  if (!isValidId(testCaseId)) throw notFound("Test case");
  const tc = await db.testCase.findFirst({
    where: { id: testCaseId, projectId, deletedAt: null },
    select: { id: true, key: true },
  });
  if (!tc) throw notFound("Test case");
  const running = await db.job.findFirst({
    where: {
      projectId,
      type: "REWRITE_TEST_CASE",
      status: { in: ["QUEUED", "RUNNING"] },
      payload: { path: ["testCaseId"], equals: tc.id },
    },
  });
  if (running) throw conflict("A rewrite of this test case is already in progress.");
  await assertBudgetLeft(projectId);
  const job = await enqueueJob({
    projectId,
    type: "REWRITE_TEST_CASE",
    payload: { testCaseId: tc.id, instruction },
    createdById: auth.user.id,
    maxAttempts: 2,
  });
  await audit({
    action: "ai.rewrite_requested",
    entityType: "test_case",
    entityId: tc.id,
    projectId,
    actorId: auth.user.id,
    metadata: { key: tc.key, jobId: job.id },
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });
  return job;
}

/**
 * Accepts a rewrite proposal: the case is updated (and goes back to Draft for review).
 * Refused if the case was changed after the rewrite was requested.
 */
export async function applyRewrite(
  auth: AuthContext,
  projectId: string,
  testCaseId: string,
  jobId: string,
  meta: Meta,
): Promise<TestCaseDto> {
  await requireProjectAccess(auth, projectId, "testcases:write");
  const job = await db.job.findFirst({
    where: { id: jobId, projectId, type: "REWRITE_TEST_CASE", status: "SUCCEEDED" },
  });
  const result = job?.result as { testCaseId?: unknown; proposal?: unknown } | null | undefined;
  if (!job || result?.testCaseId !== testCaseId) throw notFound("Rewrite");
  const parsed = rewriteOutputSchema.shape.testCase.safeParse(result.proposal);
  if (!parsed.success) throw conflict("This rewrite can no longer be applied.");
  const tc = await db.testCase.findFirst({
    where: { id: testCaseId, projectId, deletedAt: null },
    select: { updatedAt: true },
  });
  if (!tc) throw notFound("Test case");
  if (tc.updatedAt > job.createdAt) {
    throw conflict("The test case was changed after the rewrite was requested. Ask again.");
  }
  const p = parsed.data;
  const reqs = await db.requirement.findMany({
    where: { projectId, deletedAt: null, key: { in: p.requirementKeys } },
    select: { id: true },
  });
  return updateTestCase(
    auth,
    projectId,
    testCaseId,
    {
      title: p.title,
      preconditions: p.preconditions,
      steps: p.steps,
      testData: p.testData,
      expectedResult: p.expectedResult,
      type: p.type,
      priority: p.priority,
      automatable: p.automatable,
      automatableReason: p.automatableReason,
      tags: p.tags,
      ...(reqs.length ? { requirementIds: reqs.map((r) => r.id) } : {}),
    },
    meta,
    { action: "testcase.rewrite", metadata: { jobId } },
  );
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
