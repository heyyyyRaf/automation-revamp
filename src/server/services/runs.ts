import type { z } from "zod";
import type { Prisma, Run } from "@/generated/prisma/client";
import { APPROVED_LIKE } from "@/lib/domain";
import type { runControlSchema, runCreateSchema } from "@/lib/validation";
import type { AuthContext } from "@/server/auth/session";
import { isValidId, requireProjectAccess } from "@/server/authz/guards";
import { db } from "@/server/db";
import { conflict, notFound } from "@/server/errors";
import { enqueueJob } from "@/server/jobs/enqueue";
import { getRunBus } from "@/server/runs/bus";
import { FINAL_RUN, finishRun } from "@/server/runs/finish";
import { audit } from "@/server/services/audit";
import { findUsableEnvironment } from "@/server/services/environments";
import { requireApprovedTarget } from "@/server/services/targets";
import { getStorage } from "@/server/storage/storage";

interface Meta {
  ip: string;
  requestId: string;
}

/** Slow motion: delay before each browser action (also used by the live toggle). */
export const SLOW_MOTION_MS = 800;

/**
 * Hard rule: only cases that are approved AND have an approved script run — and only on a
 * verified environment at an approved address (FRD steps 5–6, NFR-3).
 */
export async function startRun(
  auth: AuthContext,
  projectId: string,
  input: z.infer<typeof runCreateSchema>,
  meta: Meta,
): Promise<Run> {
  await requireProjectAccess(auth, projectId, "runs:start");
  const env = await findUsableEnvironment(projectId, input.environmentId);
  if (!env.verifiedAt) {
    throw conflict(
      "This environment is Unverified. Run its check on the Environments page first — runs are blocked until it passes.",
    );
  }
  await requireApprovedTarget(env.projectId, env.baseUrl);
  const active = await db.run.findFirst({
    where: { projectId, status: { in: ["QUEUED", "RUNNING", "PAUSED"] } },
  });
  if (active)
    throw conflict("A run is already in progress for this project. Wait for it or stop it.");

  const sel = input.selection;
  const where: Prisma.TestCaseWhereInput = {
    projectId,
    deletedAt: null,
    automatable: true,
    status: { in: [...APPROVED_LIKE] },
    script: { is: { approvedVersionId: { not: null } } },
    ...(sel.kind === "scenario"
      ? { scenarioId: sel.scenarioId }
      : sel.kind === "tag"
        ? { tags: { has: sel.tag.toLowerCase() } }
        : sel.kind === "cases"
          ? { id: { in: sel.testCaseIds } }
          : {}),
  };
  const cases = await db.testCase.findMany({
    where,
    orderBy: { key: "asc" },
    select: { id: true, script: { select: { approvedVersionId: true } } },
    take: 500,
  });
  if (cases.length === 0) {
    throw conflict(
      "No approved script matches this selection. Approve the test cases and their scripts first.",
    );
  }
  if (sel.kind === "cases" && cases.length !== new Set(sel.testCaseIds).size) {
    throw conflict("Some selected cases have no approved script yet.");
  }

  const run = await db.$transaction(async (tx) => {
    const created = await tx.run.create({
      data: {
        projectId,
        environmentId: env.id,
        triggeredById: auth.user.id,
        timeoutSeconds: input.timeoutSeconds,
        retries: input.retries,
        slowMoMs: input.slowMotion ? SLOW_MOTION_MS : 0,
        selection: sel as Prisma.InputJsonValue,
        tests: {
          create: cases.map((c) => ({
            testCaseId: c.id,
            scriptVersionId: c.script?.approvedVersionId ?? "",
          })),
        },
      },
    });
    await audit(
      {
        action: "run.start",
        entityType: "run",
        entityId: created.id,
        projectId,
        actorId: auth.user.id,
        metadata: {
          environment: env.name,
          tests: cases.length,
          selection: sel.kind,
          timeoutSeconds: input.timeoutSeconds,
          retries: input.retries,
        },
        ipAddress: meta.ip,
        requestId: meta.requestId,
      },
      tx,
    );
    return created;
  });
  const job = await enqueueJob({
    projectId,
    type: "EXECUTE_RUN",
    payload: { runId: run.id },
    createdById: auth.user.id,
    maxAttempts: 1,
  });
  if (job.status === "FAILED") await finishRun(run.id, "error", job.error);
  return db.run.update({ where: { id: run.id }, data: { jobId: job.id } });
}

/** "Run #12": runs are numbered per project in the order they were started. */
async function numbers(projectId: string): Promise<Map<string, number>> {
  const ids = await db.run.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return new Map(ids.map((r, i) => [r.id, i + 1]));
}

export async function listRuns(auth: AuthContext, projectId: string) {
  await requireProjectAccess(auth, projectId, "projects:read");
  const [rows, nums] = await Promise.all([
    db.run.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        environment: { select: { name: true } },
        triggeredBy: { select: { name: true } },
        _count: { select: { tests: true } },
      },
    }),
    numbers(projectId),
  ]);
  return rows.map((r) => ({
    id: r.id,
    number: nums.get(r.id) ?? 0,
    status: r.status,
    environment: r.environment.name,
    triggeredBy: r.triggeredBy.name,
    total: r._count.tests,
    passed: r.passedCount,
    failed: r.failedCount,
    errors: r.errorCount,
    skipped: r.skippedCount,
    createdAt: r.createdAt,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
  }));
}

async function findRun(projectId: string, runId: string) {
  if (!isValidId(runId)) throw notFound("Run");
  const run = await db.run.findFirst({ where: { id: runId, projectId } });
  if (!run) throw notFound("Run");
  return run;
}

/** Everything the Live Run view needs to draw the current state (events then keep it fresh). */
export async function getRun(auth: AuthContext, projectId: string, runId: string) {
  await requireProjectAccess(auth, projectId, "projects:read");
  const run = await db.run.findFirst({
    where: { id: runId, projectId },
    include: {
      environment: { select: { id: true, name: true, baseUrl: true } },
      triggeredBy: { select: { name: true } },
      tests: {
        orderBy: { testCase: { key: "asc" } },
        include: {
          testCase: {
            select: { id: true, key: true, title: true, script: { select: { id: true } } },
          },
          steps: { orderBy: { index: "asc" } },
        },
      },
    },
  });
  if (!run) throw notFound("Run");
  const number = (await numbers(projectId)).get(run.id) ?? 0;
  return {
    id: run.id,
    number,
    status: run.status,
    error: run.error,
    environment: run.environment,
    triggeredBy: run.triggeredBy.name,
    timeoutSeconds: run.timeoutSeconds,
    retries: run.retries,
    slowMotion: run.slowMoMs > 0,
    workers: run.workers,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    counts: {
      passed: run.passedCount,
      failed: run.failedCount,
      errors: run.errorCount,
      skipped: run.skippedCount,
    },
    tests: run.tests.map((t) => ({
      id: t.id,
      testCaseId: t.testCase.id,
      scriptId: t.testCase.script?.id ?? null,
      key: t.testCase.key,
      title: t.testCase.title,
      status: t.status,
      attempts: t.attempts,
      durationMs: t.durationMs,
      error: t.errorMessage,
      has: {
        trace: Boolean(t.traceKey),
        screenshot: Boolean(t.screenshotKey),
        log: Boolean(t.logKey),
        console: Boolean(t.consoleKey),
        network: Boolean(t.networkKey),
      },
      steps: t.steps.map((s) => ({
        id: s.id,
        index: s.index,
        title: s.title,
        category: s.category,
        status: s.status,
        durationMs: s.durationMs,
        error: s.error,
        hasScreenshot: Boolean(s.screenshotKey),
      })),
    })),
  };
}

export type RunDetail = Awaited<ReturnType<typeof getRun>>;

/** Pause / resume / slow motion / stop (design: Live run header). */
export async function controlRun(
  auth: AuthContext,
  projectId: string,
  runId: string,
  input: z.infer<typeof runControlSchema>,
  meta: Meta,
) {
  await requireProjectAccess(auth, projectId, "runs:control");
  const run = await findRun(projectId, runId);
  if (FINAL_RUN.includes(run.status)) throw conflict("This run has already finished.");
  const { action } = input;
  if (action === "pause" && run.status !== "RUNNING")
    throw conflict("Only a running run can be paused.");
  if (action === "resume" && run.status !== "PAUSED") throw conflict("This run is not paused.");
  if (action === "stop" && run.status === "QUEUED") {
    // Not started yet: nothing to interrupt, the run simply ends.
    await finishRun(run.id, "cancelled");
  } else {
    await getRunBus().sendControl(run.id, action);
  }
  await audit({
    action: "run.control",
    entityType: "run",
    entityId: run.id,
    projectId,
    actorId: auth.user.id,
    metadata: { action },
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });
}

export type ArtifactKind = "trace" | "screenshot" | "log" | "console" | "network";

const ARTIFACT: Record<
  ArtifactKind,
  {
    field: "traceKey" | "screenshotKey" | "logKey" | "consoleKey" | "networkKey";
    mime: string;
    ext: string;
  }
> = {
  trace: { field: "traceKey", mime: "application/zip", ext: "zip" },
  screenshot: { field: "screenshotKey", mime: "image/png", ext: "png" },
  log: { field: "logKey", mime: "text/plain; charset=utf-8", ext: "txt" },
  console: { field: "consoleKey", mime: "application/json", ext: "json" },
  network: { field: "networkKey", mime: "application/json", ext: "json" },
};

/** FR-8.3: per-case artifacts. Only from runs of this project. */
export async function getRunArtifact(
  auth: AuthContext,
  projectId: string,
  runId: string,
  runTestId: string,
  kind: ArtifactKind,
) {
  await requireProjectAccess(auth, projectId, "projects:read", { allowArchived: true });
  const run = await findRun(projectId, runId);
  if (!isValidId(runTestId)) throw notFound("Result");
  const rt = await db.runTest.findFirst({
    where: { id: runTestId, runId: run.id },
    include: { testCase: { select: { key: true } } },
  });
  const spec = ARTIFACT[kind];
  const key = rt?.[spec.field];
  if (!rt || !key) throw notFound("File");
  return {
    bytes: await getStorage().get(key),
    mimeType: spec.mime,
    fileName: `${rt.testCase.key}-${kind}.${spec.ext}`,
  };
}

/** The page as it was after a step (design: "click a step to see the page"). */
export async function getStepScreenshot(
  auth: AuthContext,
  projectId: string,
  runId: string,
  stepId: string,
) {
  await requireProjectAccess(auth, projectId, "projects:read", { allowArchived: true });
  const run = await findRun(projectId, runId);
  if (!isValidId(stepId)) throw notFound("Step");
  const step = await db.runStep.findFirst({
    where: { id: stepId, runTest: { runId: run.id } },
  });
  if (!step?.screenshotKey) throw notFound("Screenshot");
  return { bytes: await getStorage().get(step.screenshotKey), mimeType: "image/jpeg" };
}

/** Server-sent events need the run to exist in this project before subscribing. */
export async function assertRunReadable(auth: AuthContext, projectId: string, runId: string) {
  await requireProjectAccess(auth, projectId, "projects:read");
  return findRun(projectId, runId);
}
