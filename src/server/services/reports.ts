import type { FailureCause, TestResultStatus } from "@/generated/prisma/client";
import type { AuthContext } from "@/server/auth/session";
import { isValidId, requireProjectAccess } from "@/server/authz/guards";
import { db } from "@/server/db";
import { conflict, notFound } from "@/server/errors";
import { FINAL_RUN, startFailureAnalysis } from "@/server/runs/finish";
import { audit } from "@/server/services/audit";
import { assertBudgetLeft, assertNotRunning } from "@/server/services/job-guards";

/** FR-9.2: what each requirement's latest results say. */
export type CoverageStatus = "PASSING" | "FAILING" | "NOT_RUN" | "MANUAL" | "NOT_COVERED";

const FINAL: TestResultStatus[] = ["PASSED", "FAILED", "ERROR"];

/**
 * FR-9.2 coverage matrix: requirement → cases → latest result. "Latest" means as of the given
 * run (so an old report never changes), across every run of the project up to then.
 */
export async function coverage(projectId: string, asOf: Date) {
  const [requirements, results] = await Promise.all([
    db.requirement.findMany({
      // Merged requirements live on in the one they were merged into.
      where: { projectId, deletedAt: null, status: { not: "MERGED" } },
      orderBy: { key: "asc" },
      select: {
        id: true,
        key: true,
        text: true,
        testCases: {
          where: { testCase: { deletedAt: null, status: { not: "REJECTED" } } },
          select: { testCase: { select: { id: true, key: true, automatable: true } } },
        },
      },
    }),
    db.runTest.findMany({
      where: {
        run: { projectId, createdAt: { lte: asOf } },
        status: { in: FINAL },
      },
      orderBy: { run: { createdAt: "desc" } },
      select: { testCaseId: true, status: true },
    }),
  ]);
  const latest = new Map<string, TestResultStatus>();
  for (const r of results) if (!latest.has(r.testCaseId)) latest.set(r.testCaseId, r.status);

  const rows = requirements.map((req) => {
    const cases = req.testCases.map((l) => l.testCase);
    const auto = cases.filter((c) => c.automatable);
    let status: CoverageStatus;
    if (cases.length === 0) status = "NOT_COVERED";
    else if (auto.length === 0) status = "MANUAL";
    else if (auto.some((c) => ["FAILED", "ERROR"].includes(latest.get(c.id) ?? "")))
      status = "FAILING";
    else if (auto.every((c) => latest.get(c.id) === "PASSED")) status = "PASSING";
    else status = "NOT_RUN";
    return {
      id: req.id,
      key: req.key,
      text: req.text,
      status,
      cases: cases.map((c) => ({
        key: c.key,
        automatable: c.automatable,
        latest: latest.get(c.id) ?? null,
      })),
    };
  });
  return {
    total: rows.length,
    covered: rows.filter((r) => r.status !== "NOT_COVERED").length,
    rows,
  };
}

export type Coverage = Awaited<ReturnType<typeof coverage>>;

/** FR-9.1: totals, pass rate, failures with screenshots and causes, manual-only cases. */
export async function buildRunReport(projectId: string, runId: string) {
  if (!isValidId(runId)) throw notFound("Run");
  const run = await db.run.findFirst({
    where: { id: runId, projectId },
    include: {
      project: { select: { id: true, name: true } },
      environment: { select: { name: true, baseUrl: true } },
      triggeredBy: { select: { name: true } },
      tests: {
        orderBy: { testCase: { key: "asc" } },
        include: {
          testCase: {
            select: {
              id: true,
              key: true,
              title: true,
              requirements: { select: { requirement: { select: { key: true } } } },
            },
          },
          defects: {
            select: { id: true, key: true, status: true },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      },
    },
  });
  if (!run) throw notFound("Run");
  const [number, manualCases, cov, analysisJob] = await Promise.all([
    db.run.count({ where: { projectId, createdAt: { lte: run.createdAt } } }),
    // Manual-only cases appear in the report (FR-4.4): approved cases a browser can't check.
    db.testCase.findMany({
      where: {
        projectId,
        deletedAt: null,
        automatable: false,
        status: { notIn: ["DRAFT", "REJECTED"] },
      },
      orderBy: { key: "asc" },
      select: { id: true, key: true, title: true, automatableReason: true },
    }),
    coverage(projectId, run.finishedAt ?? new Date()),
    db.job.findFirst({
      where: { projectId, type: "ANALYZE_FAILURES", payload: { path: ["runId"], equals: run.id } },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, error: true },
    }),
  ]);
  const automated = run.tests.length;
  const passed = run.tests.filter((t) => t.status === "PASSED").length;
  const failures = run.tests
    .filter((t) => t.status === "FAILED" || t.status === "ERROR")
    .map((t) => ({
      runTestId: t.id,
      testCaseId: t.testCase.id,
      key: t.testCase.key,
      title: t.testCase.title,
      requirementKeys: t.testCase.requirements.map((r) => r.requirement.key),
      status: t.status as "FAILED" | "ERROR",
      error: t.errorMessage,
      attempts: t.attempts,
      hasScreenshot: Boolean(t.screenshotKey),
      hasTrace: Boolean(t.traceKey),
      likelyCause: t.likelyCause as FailureCause | null,
      causeExplanation: t.causeExplanation,
      defect: t.defects[0] ?? null,
    }));
  return {
    project: run.project,
    run: {
      id: run.id,
      number,
      status: run.status,
      error: run.error,
      environment: run.environment.name,
      baseUrl: run.environment.baseUrl,
      triggeredBy: run.triggeredBy.name,
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      durationMs:
        run.startedAt && run.finishedAt ? run.finishedAt.getTime() - run.startedAt.getTime() : null,
      retries: run.retries,
      timeoutSeconds: run.timeoutSeconds,
    },
    totals: {
      automated,
      passed,
      failed: run.tests.filter((t) => t.status === "FAILED").length,
      errors: run.tests.filter((t) => t.status === "ERROR").length,
      skipped: run.tests.filter((t) => t.status === "SKIPPED").length,
      manual: manualCases.length,
      passRate: automated ? Math.round((passed / automated) * 100) : null,
    },
    failures,
    passedCases: run.tests
      .filter((t) => t.status === "PASSED" || t.status === "SKIPPED")
      .map((t) => ({
        key: t.testCase.key,
        title: t.testCase.title,
        status: t.status,
        durationMs: t.durationMs,
      })),
    manualCases,
    coverage: cov,
    analysis: analysisJob ? { status: analysisJob.status, error: analysisJob.error } : null,
  };
}

export type RunReport = Awaited<ReturnType<typeof buildRunReport>>;

export async function getRunReport(auth: AuthContext, projectId: string, runId: string) {
  await requireProjectAccess(auth, projectId, "projects:read", { allowArchived: true });
  return buildRunReport(projectId, runId);
}

export async function getCoverage(auth: AuthContext, projectId: string) {
  await requireProjectAccess(auth, projectId, "projects:read", { allowArchived: true });
  return coverage(projectId, new Date());
}

/** FR-9.3: ask the AI again for the likely cause of each failure (e.g. after it failed). */
export async function requestFailureAnalysis(
  auth: AuthContext,
  projectId: string,
  runId: string,
  meta: { ip: string; requestId: string },
) {
  await requireProjectAccess(auth, projectId, "ai:run");
  if (!isValidId(runId)) throw notFound("Run");
  const run = await db.run.findFirst({
    where: { id: runId, projectId },
    select: { id: true, status: true },
  });
  if (!run) throw notFound("Run");
  if (!FINAL_RUN.includes(run.status)) throw conflict("Wait for this run to finish first.");
  await assertNotRunning(projectId, "ANALYZE_FAILURES");
  await assertBudgetLeft(projectId);
  const job = await startFailureAnalysis(projectId, run.id, auth.user.id);
  if (!job) throw conflict("Nothing failed in this run.");
  await audit({
    action: "run.analyze_requested",
    entityType: "run",
    entityId: run.id,
    projectId,
    actorId: auth.user.id,
    metadata: { jobId: job.id },
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });
  return job;
}
