import type { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { APPROVED_LIKE } from "@/lib/domain";
import type { scriptApproveSchema, scriptFixSchema, scriptGenerateSchema } from "@/lib/validation";
import type { AuthContext } from "@/server/auth/session";
import { isValidId, requireProjectAccess } from "@/server/authz/guards";
import { db } from "@/server/db";
import { conflict, notFound } from "@/server/errors";
import { enqueueJob } from "@/server/jobs/enqueue";
import {
  compiles,
  loadPages,
  runChecks,
  saveVersion,
  storedChecks,
} from "@/server/scripts/pipeline";
import { standaloneProject } from "@/server/scripts/standalone";
import { audit } from "@/server/services/audit";
import { findUsableEnvironment } from "@/server/services/environments";
import { assertBudgetLeft, assertNotRunning } from "@/server/services/job-guards";

interface Meta {
  ip: string;
  requestId: string;
}

/**
 * Script states shown in the list (design: Ready / Edited / Needs look, plus Approved and
 * Not written yet).
 */
export type ScriptState = "NOT_GENERATED" | "NEEDS_EDIT" | "READY" | "EDITED" | "APPROVED";

const approvedLike = APPROVED_LIKE as readonly string[];

/** One row per approved, automatable case: the cases that can have a script (FR-5.1). */
export async function listScripts(auth: AuthContext, projectId: string) {
  await requireProjectAccess(auth, projectId, "projects:read");
  const cases = await db.testCase.findMany({
    where: {
      projectId,
      deletedAt: null,
      automatable: true,
      status: { in: [...APPROVED_LIKE] },
    },
    orderBy: { key: "asc" },
    select: {
      id: true,
      key: true,
      title: true,
      type: true,
      status: true,
      scenario: { select: { id: true, key: true, title: true } },
      requirements: { select: { requirement: { select: { key: true } } } },
      script: {
        select: {
          id: true,
          status: true,
          needsEdit: true,
          approvedVersionId: true,
          updatedAt: true,
          versions: {
            orderBy: { version: "desc" },
            take: 1,
            select: {
              id: true,
              version: true,
              source: true,
              typeCheckOk: true,
              safetyCheckOk: true,
              selectorCheck: true,
            },
          },
        },
      },
    },
  });
  return cases.map((c) => {
    const latest = c.script?.versions[0] ?? null;
    const missing = latest
      ? storedChecks({ ...latest, typeCheckLog: [], safetyIssues: [] }).selectorCheck.filter(
          (s) => s.status === "missing",
        ).length
      : 0;
    let state: ScriptState = "NOT_GENERATED";
    if (c.script && latest) {
      if (c.script.approvedVersionId === latest.id) state = "APPROVED";
      else if (c.script.needsEdit || !latest.typeCheckOk || !latest.safetyCheckOk || missing > 0)
        state = "NEEDS_EDIT";
      else if (latest.source === "MANUAL_EDIT") state = "EDITED";
      else state = "READY";
    }
    return {
      testCaseId: c.id,
      key: c.key,
      title: c.title,
      type: c.type,
      caseStatus: c.status,
      scenario: c.scenario,
      requirementKeys: c.requirements.map((r) => r.requirement.key),
      scriptId: c.script?.id ?? null,
      state,
      version: latest?.version ?? null,
      missingSelectors: missing,
      updatedAt: c.script?.updatedAt ?? null,
    };
  });
}

async function findScript(projectId: string, scriptId: string) {
  if (!isValidId(scriptId)) throw notFound("Script");
  const script = await db.script.findFirst({ where: { id: scriptId, projectId } });
  if (!script) throw notFound("Script");
  return script;
}

/** One script with every version (newest first), its checks, and where it came from. */
export async function getScript(auth: AuthContext, projectId: string, scriptId: string) {
  await requireProjectAccess(auth, projectId, "projects:read");
  const script = await db.script.findFirst({
    where: { id: scriptId, projectId },
    include: {
      testCase: {
        select: {
          id: true,
          key: true,
          title: true,
          type: true,
          status: true,
          automatable: true,
          requirements: { select: { requirement: { select: { key: true } } } },
        },
      },
      approvedBy: { select: { name: true } },
      versions: {
        orderBy: { version: "desc" },
        include: {
          createdBy: { select: { name: true } },
          domSnapshot: { select: { url: true, capturedAt: true } },
        },
      },
    },
  });
  if (!script) throw notFound("Script");
  const environment = script.environmentId
    ? await db.environment.findUnique({
        where: { id: script.environmentId },
        select: { id: true, name: true, baseUrl: true },
      })
    : null;
  return {
    id: script.id,
    startPath: script.startPath,
    needsEdit: script.needsEdit,
    status: script.status,
    approvedVersionId: script.approvedVersionId,
    approvedBy: script.approvedBy?.name ?? null,
    approvedAt: script.approvedAt,
    environment,
    testCase: {
      id: script.testCase.id,
      key: script.testCase.key,
      title: script.testCase.title,
      type: script.testCase.type,
      status: script.testCase.status,
      requirementKeys: script.testCase.requirements.map((r) => r.requirement.key),
    },
    versions: script.versions.map((v) => ({
      id: v.id,
      version: v.version,
      code: v.code,
      source: v.source,
      notes: v.notes,
      createdBy: v.createdBy?.name ?? null,
      createdAt: v.createdAt,
      capturedFrom: v.domSnapshot?.url ?? null,
      checks: storedChecks(v),
    })),
  };
}

export type ScriptDetail = Awaited<ReturnType<typeof getScript>>;

/** FRD step 4 precondition: at least one Approved, Automatable case and one environment. */
export async function generateScripts(
  auth: AuthContext,
  projectId: string,
  input: z.infer<typeof scriptGenerateSchema>,
  meta: Meta,
) {
  await requireProjectAccess(auth, projectId, "scripts:write");
  await assertNotRunning(projectId, "GENERATE_SCRIPT");
  await assertBudgetLeft(projectId);
  const env = await findUsableEnvironment(projectId, input.environmentId);
  const where: Prisma.TestCaseWhereInput = {
    projectId,
    deletedAt: null,
    automatable: true,
    status: { in: [...APPROVED_LIKE] },
    ...(input.testCaseIds?.length ? { id: { in: input.testCaseIds } } : { script: { is: null } }),
  };
  const cases = await db.testCase.findMany({ where, select: { id: true }, take: 200 });
  if (input.testCaseIds?.length && cases.length !== new Set(input.testCaseIds).size) {
    throw conflict(
      "Scripts can only be written for approved test cases that can be automated (FR-5.1).",
    );
  }
  if (cases.length === 0) {
    throw conflict(
      "There's nothing to write: approve automatable test cases first, or pick cases to rewrite.",
    );
  }
  const job = await enqueueJob({
    projectId,
    type: "GENERATE_SCRIPT",
    payload: {
      testCaseIds: cases.map((c) => c.id),
      environmentId: env.id,
      startPath: input.startPath,
    },
    createdById: auth.user.id,
    maxAttempts: 1,
  });
  await audit({
    action: "script.generate_requested",
    entityType: "job",
    entityId: job.id,
    projectId,
    actorId: auth.user.id,
    metadata: { cases: cases.length, environmentId: env.id },
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });
  return job;
}

/** FR-6.3: the tester's edit becomes a new version; it is checked and must be approved. */
export async function saveScriptEdit(
  auth: AuthContext,
  projectId: string,
  scriptId: string,
  code: string,
  meta: Meta,
) {
  await requireProjectAccess(auth, projectId, "scripts:write");
  const script = await findScript(projectId, scriptId);
  const latest = await db.scriptVersion.findFirst({
    where: { scriptId: script.id },
    orderBy: { version: "desc" },
  });
  if (latest && latest.code === code) throw conflict("Nothing changed.");
  const pages = await loadPages(latest?.domSnapshotId ?? null);
  const checks = runChecks(code, pages);
  const version = await saveVersion({
    scriptId: script.id,
    code,
    source: "MANUAL_EDIT",
    checks,
    notes: null,
    domSnapshotId: latest?.domSnapshotId ?? null,
    createdById: auth.user.id,
    needsEdit: !compiles(checks),
  });
  await audit({
    action: "script.version_create",
    entityType: "script",
    entityId: script.id,
    projectId,
    actorId: auth.user.id,
    metadata: { version: version.version, compiles: compiles(checks) },
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });
  return version;
}

export async function requestScriptFix(
  auth: AuthContext,
  projectId: string,
  scriptId: string,
  input: z.infer<typeof scriptFixSchema>,
  meta: Meta,
) {
  await requireProjectAccess(auth, projectId, "scripts:write");
  const script = await findScript(projectId, scriptId);
  await assertBudgetLeft(projectId);
  const running = await db.job.findFirst({
    where: {
      projectId,
      type: "FIX_SCRIPT",
      status: { in: ["QUEUED", "RUNNING"] },
      payload: { path: ["scriptId"], equals: script.id },
    },
  });
  if (running) throw conflict("The AI is already fixing this script.");
  if (input.runTestId && !isValidId(input.runTestId)) throw notFound("Run result");
  const job = await enqueueJob({
    projectId,
    type: "FIX_SCRIPT",
    payload: {
      scriptId: script.id,
      instruction: input.instruction ?? null,
      runTestId: input.runTestId ?? null,
    },
    createdById: auth.user.id,
    maxAttempts: 1,
  });
  await audit({
    action: "script.fix_requested",
    entityType: "script",
    entityId: script.id,
    projectId,
    actorId: auth.user.id,
    metadata: { jobId: job.id },
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });
  return job;
}

/**
 * The approval gate: a version runs only after a tester approves it, and only if it passed
 * the type and safety checks and its test case is approved (FR-5.1).
 */
export async function decideScript(
  auth: AuthContext,
  projectId: string,
  scriptId: string,
  input: z.infer<typeof scriptApproveSchema>,
  meta: Meta,
) {
  await requireProjectAccess(auth, projectId, "scripts:approve");
  const script = await findScript(projectId, scriptId);
  const testCase = await db.testCase.findUniqueOrThrow({ where: { id: script.testCaseId } });
  if (input.decision === "REVOKE") {
    await db.$transaction(async (tx) => {
      await tx.script.update({
        where: { id: script.id },
        data: { status: "DRAFT", approvedVersionId: null, approvedById: null, approvedAt: null },
      });
      await tx.testCase.updateMany({
        where: { id: testCase.id, status: "SCRIPTED" },
        data: { status: "APPROVED" },
      });
    });
    await audit({
      action: "script.revoke",
      entityType: "script",
      entityId: script.id,
      projectId,
      actorId: auth.user.id,
      ipAddress: meta.ip,
      requestId: meta.requestId,
    });
    return;
  }
  if (!isValidId(input.versionId)) throw notFound("Version");
  const version = await db.scriptVersion.findFirst({
    where: { id: input.versionId, scriptId: script.id },
  });
  if (!version) throw notFound("Version");
  const latest = await db.scriptVersion.findFirst({
    where: { scriptId: script.id },
    orderBy: { version: "desc" },
    select: { id: true },
  });
  if (latest?.id !== version.id) {
    throw conflict("Approve the latest version — a newer one exists.");
  }
  if (!version.typeCheckOk || !version.safetyCheckOk) {
    throw conflict("This version has errors. Fix them (or ask the AI to) before approving.");
  }
  if (!approvedLike.includes(testCase.status) || testCase.deletedAt || !testCase.automatable) {
    throw conflict("Its test case must be approved and automatable first.");
  }
  await db.$transaction(async (tx) => {
    await tx.script.update({
      where: { id: script.id },
      data: {
        status: "APPROVED",
        approvedVersionId: version.id,
        approvedById: auth.user.id,
        approvedAt: new Date(),
        needsEdit: false,
      },
    });
    await tx.testCase.updateMany({
      where: { id: testCase.id, status: "APPROVED" },
      data: { status: "SCRIPTED" },
    });
    await audit(
      {
        action: "script.approve",
        entityType: "script",
        entityId: script.id,
        projectId,
        actorId: auth.user.id,
        metadata: { version: version.version, testCase: testCase.key },
        before: { status: script.status },
        after: { status: "APPROVED" },
        ipAddress: meta.ip,
        requestId: meta.requestId,
      },
      tx,
    );
  });
}

/** Design "Download scripts (.zip)" / FR-6.5: approved scripts as a Playwright project. */
export async function downloadScripts(auth: AuthContext, projectId: string, meta: Meta) {
  const project = await requireProjectAccess(auth, projectId, "projects:read", {
    allowArchived: true,
  });
  const scripts = await db.script.findMany({
    where: { projectId, approvedVersionId: { not: null } },
    include: {
      approvedVersion: { select: { code: true } },
      testCase: { select: { key: true, title: true } },
    },
    orderBy: { testCase: { key: "asc" } },
  });
  if (scripts.length === 0) throw conflict("No script has been approved yet.");
  const bytes = standaloneProject(
    project.name,
    scripts.map((s) => ({
      key: s.testCase.key,
      title: s.testCase.title,
      code: s.approvedVersion?.code ?? "",
    })),
  );
  await audit({
    action: "script.download",
    entityType: "project",
    entityId: projectId,
    projectId,
    actorId: auth.user.id,
    metadata: { scripts: scripts.length },
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });
  const base = project.name.replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-|-$/g, "") || "project";
  return { bytes, mimeType: "application/zip", fileName: `${base}-playwright-tests.zip` };
}
