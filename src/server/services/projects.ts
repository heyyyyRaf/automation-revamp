import type { z } from "zod";
import type { Prisma, Project } from "@/generated/prisma/client";
import type { createProjectSchema, updateProjectSchema } from "@/lib/validation";
import type { AuthContext } from "@/server/auth/session";
import {
  accessibleProjectsWhere,
  requireOwnerOrAdmin,
  requirePermission,
  requireProjectAccess,
} from "@/server/authz/guards";
import { db } from "@/server/db";
import { badRequest, forbidden } from "@/server/errors";
import { audit, changes } from "@/server/services/audit";

interface Meta {
  ip: string;
  requestId: string;
}

/** Stage chip on the projects dashboard (design: Main). */
export type ProjectStage = "NOT_STARTED" | "ANALYSING" | "REVIEWING" | "FAILING" | "REPORT_READY";

/** Below this last-run pass rate a project counts as failing (same threshold as the bar colour). */
export const PASS_RATE_OK = 85;

export interface ProjectSummary {
  id: string;
  name: string;
  description: string | null;
  status: Project["status"];
  owner: { id: string; name: string };
  createdAt: Date;
  updatedAt: Date;
  documentCount: number;
  memberCount: number;
  testCaseCount: number;
  draftCount: number;
  stage: ProjectStage;
  /** Pass rate of the last finished run, 0–100; null = not run yet. */
  lastPassRate: number | null;
  /** The most recent thing that happened, for "Ran today, 9:40 AM" / "Uploaded 5 min ago". */
  activity: { kind: "ran" | "uploaded" | "updated" | "created"; at: Date };
}

export interface DashboardStats {
  activeProjects: number;
  addedThisWeek: number;
  testsRunThisWeek: number;
  projectsRunThisWeek: number;
  /** Mean of each project's last-run pass rate; null when nothing has run. */
  averagePassRate: number | null;
  awaitingReview: number;
}

const BUSY_JOB_TYPES = [
  "EXTRACT_TEXT",
  "IMPORT_FIGMA",
  "ANALYZE_REQUIREMENTS",
  "GENERATE_TEST_CASES",
] as const;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function passRate(r: {
  passedCount: number;
  failedCount: number;
  errorCount: number;
}): number | null {
  const total = r.passedCount + r.failedCount + r.errorCount;
  return total === 0 ? null : Math.round((r.passedCount / total) * 100);
}

export async function listProjects(
  auth: AuthContext,
  options: { includeArchived?: boolean } = {},
): Promise<ProjectSummary[]> {
  const where: Prisma.ProjectWhereInput = {
    ...accessibleProjectsWhere(auth),
    ...(options.includeArchived ? {} : { status: "ACTIVE" }),
  };
  const rows = await db.project.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    include: {
      owner: { select: { id: true, name: true } },
      _count: { select: { documents: { where: { deletedAt: null } }, members: true } },
    },
  });
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const [caseCounts, lastRuns, busyJobs, lastDocs] = await Promise.all([
    db.testCase.groupBy({
      by: ["projectId", "status"],
      where: { projectId: { in: ids }, deletedAt: null },
      _count: { _all: true },
    }),
    db.run.findMany({
      where: { projectId: { in: ids }, status: { in: ["PASSED", "FAILED"] } },
      orderBy: { createdAt: "desc" },
      distinct: ["projectId"],
      select: {
        projectId: true,
        passedCount: true,
        failedCount: true,
        errorCount: true,
        finishedAt: true,
        createdAt: true,
      },
    }),
    db.job.groupBy({
      by: ["projectId"],
      where: {
        projectId: { in: ids },
        type: { in: [...BUSY_JOB_TYPES] },
        status: { in: ["QUEUED", "RUNNING"] },
      },
      _count: { _all: true },
    }),
    db.document.groupBy({
      by: ["projectId"],
      where: { projectId: { in: ids }, deletedAt: null },
      _max: { createdAt: true },
    }),
  ]);

  return rows.map(({ _count, owner, ...p }) => {
    const cases = caseCounts.filter((c) => c.projectId === p.id);
    const testCaseCount = cases.reduce(
      (n, c) => (c.status === "REJECTED" ? n : n + c._count._all),
      0,
    );
    const draftCount = cases.find((c) => c.status === "DRAFT")?._count._all ?? 0;
    const run = lastRuns.find((r) => r.projectId === p.id);
    const lastPassRate = run ? passRate(run) : null;
    const busy = busyJobs.some((j) => j.projectId === p.id);
    const lastDoc = lastDocs.find((d) => d.projectId === p.id)?._max.createdAt ?? null;

    let stage: ProjectStage;
    if (busy || (_count.documents > 0 && testCaseCount === 0)) stage = "ANALYSING";
    else if (draftCount > 0) stage = "REVIEWING";
    else if (run) stage = (lastPassRate ?? 0) < PASS_RATE_OK ? "FAILING" : "REPORT_READY";
    else if (testCaseCount > 0) stage = "REVIEWING";
    else stage = "NOT_STARTED";

    const ranAt = run ? (run.finishedAt ?? run.createdAt) : null;
    const activity: ProjectSummary["activity"] =
      ranAt && (!lastDoc || ranAt >= lastDoc)
        ? { kind: "ran", at: ranAt }
        : lastDoc && lastDoc >= p.updatedAt
          ? { kind: "uploaded", at: lastDoc }
          : p.updatedAt.getTime() - p.createdAt.getTime() > 1000
            ? { kind: "updated", at: p.updatedAt }
            : { kind: "created", at: p.createdAt };

    return {
      id: p.id,
      name: p.name,
      description: p.description,
      status: p.status,
      owner,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      documentCount: _count.documents,
      memberCount: _count.members,
      testCaseCount,
      draftCount,
      stage,
      lastPassRate,
      activity,
    };
  });
}

/** The four tiles at the top of the projects dashboard, over the projects the caller can see. */
export async function dashboardStats(
  auth: AuthContext,
  projects: ProjectSummary[],
  now = new Date(),
): Promise<DashboardStats> {
  const active = projects.filter((p) => p.status === "ACTIVE");
  const weekAgo = new Date(now.getTime() - WEEK_MS);
  const runs = await db.run.findMany({
    where: {
      project: accessibleProjectsWhere(auth),
      createdAt: { gte: weekAgo },
      status: { in: ["PASSED", "FAILED", "ERROR", "CANCELLED"] },
    },
    select: {
      projectId: true,
      passedCount: true,
      failedCount: true,
      errorCount: true,
      skippedCount: true,
    },
  });
  const rates = active.map((p) => p.lastPassRate).filter((r): r is number => r !== null);
  return {
    activeProjects: active.length,
    addedThisWeek: active.filter((p) => p.createdAt >= weekAgo).length,
    testsRunThisWeek: runs.reduce(
      (n, r) => n + r.passedCount + r.failedCount + r.errorCount + r.skippedCount,
      0,
    ),
    projectsRunThisWeek: new Set(runs.map((r) => r.projectId)).size,
    averagePassRate: rates.length
      ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length)
      : null,
    awaitingReview: active.reduce((n, p) => n + p.draftCount, 0),
  };
}

/** An owner must be an active Admin or QA Tester (Viewers are read-only). */
async function assertEligibleOwner(userId: string): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { isActive: true, role: true },
  });
  if (!user || !user.isActive) throw badRequest("Choose an active user as the owner.");
  if (user.role === "VIEWER") {
    throw badRequest("A Viewer can't own a project. Choose a QA Tester or Admin.");
  }
}

export async function createProject(
  auth: AuthContext,
  input: z.infer<typeof createProjectSchema>,
  meta: Meta,
): Promise<Project> {
  requirePermission(auth, "projects:create");
  // FR-1.1: the owner defaults to the creator. Only an Admin may create a project for someone else.
  const ownerId = input.ownerId ?? auth.user.id;
  if (ownerId !== auth.user.id) {
    if (auth.user.role !== "ADMIN") {
      throw forbidden("Only an Admin can create a project for someone else.");
    }
    await assertEligibleOwner(ownerId);
  }
  const memberIds = [...new Set([auth.user.id, ownerId])];
  return db.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        name: input.name,
        description: input.description || null,
        createdById: auth.user.id,
        ownerId,
        members: { create: memberIds.map((userId) => ({ userId })) },
      },
    });
    await audit(
      {
        action: "project.create",
        entityType: "project",
        entityId: project.id,
        projectId: project.id,
        actorId: auth.user.id,
        metadata: { name: project.name },
        after: { name: project.name, description: project.description, ownerId },
        ipAddress: meta.ip,
        requestId: meta.requestId,
      },
      tx,
    );
    return project;
  });
}

export function getProject(auth: AuthContext, projectId: string): Promise<Project> {
  return requireProjectAccess(auth, projectId, "projects:read");
}

/** Index into FLOW_STEPS: Upload, Analyse, Test cases, Review, Environment, Scripts, Run, Report. */
export type FlowStepIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Project header data: owner and where the project is in the 8-step flow (design). */
export async function getProjectOverview(auth: AuthContext, projectId: string) {
  const project = await requireProjectAccess(auth, projectId, "projects:read");
  const [owner, docs, reqs, cases, drafts, approved, envs, approvedScripts, finishedRuns] =
    await Promise.all([
      db.user.findUnique({ where: { id: project.ownerId }, select: { id: true, name: true } }),
      db.document.count({ where: { projectId, deletedAt: null } }),
      db.requirement.count({ where: { projectId, deletedAt: null } }),
      db.testCase.count({ where: { projectId, deletedAt: null, status: { not: "REJECTED" } } }),
      db.testCase.count({ where: { projectId, deletedAt: null, status: "DRAFT" } }),
      db.testCase.count({
        where: {
          projectId,
          deletedAt: null,
          status: { in: ["APPROVED", "SCRIPTED", "PASSED", "FAILED", "ERROR"] },
        },
      }),
      // Step 5 is done once an environment this project can use has been verified.
      db.environment.count({
        where: { OR: [{ projectId }, { projectId: null }], verifiedAt: { not: null } },
      }),
      db.script.count({ where: { projectId, status: "APPROVED" } }),
      db.run.count({ where: { projectId, status: { in: ["PASSED", "FAILED"] } } }),
    ]);
  let step: FlowStepIndex;
  if (docs === 0) step = 0;
  else if (reqs === 0) step = 1;
  else if (cases === 0) step = 2;
  else if (drafts > 0 || approved === 0) step = 3;
  else if (envs === 0) step = 4;
  else if (approvedScripts === 0) step = 5;
  else if (finishedRuns === 0) step = 6;
  else step = 7;
  return {
    project,
    owner: owner ?? { id: project.ownerId, name: "Unknown" },
    step,
    counts: { docs, reqs, cases, drafts, approved },
  };
}

export async function updateProject(
  auth: AuthContext,
  projectId: string,
  input: z.infer<typeof updateProjectSchema>,
  meta: Meta,
): Promise<Project> {
  const statusChange = input.status !== undefined;
  const fieldChange =
    input.name !== undefined || input.description !== undefined || input.ownerId !== undefined;
  // Archive/restore needs the archive permission and must work on archived projects.
  const project = await requireProjectAccess(
    auth,
    projectId,
    statusChange ? "projects:archive" : "projects:edit",
    { allowArchived: statusChange && !fieldChange },
  );
  requireOwnerOrAdmin(auth, project);

  const data: Prisma.ProjectUncheckedUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description || null;
  if (input.status !== undefined && input.status !== project.status) {
    data.status = input.status;
    data.archivedAt = input.status === "ARCHIVED" ? new Date() : null;
  }
  const newOwnerId =
    input.ownerId !== undefined && input.ownerId !== project.ownerId ? input.ownerId : null;
  if (newOwnerId) {
    await assertEligibleOwner(newOwnerId);
    data.ownerId = newOwnerId;
  }

  return db.$transaction(async (tx) => {
    const updated = await tx.project.update({ where: { id: project.id }, data });
    if (newOwnerId) {
      // The new owner must be able to see the project.
      await tx.projectMember.upsert({
        where: { projectId_userId: { projectId: project.id, userId: newOwnerId } },
        create: { projectId: project.id, userId: newOwnerId },
        update: {},
      });
    }
    const action =
      data.status === "ARCHIVED"
        ? "project.archive"
        : data.status === "ACTIVE"
          ? "project.restore"
          : "project.update";
    const diff = changes(project, updated, ["name", "description", "status", "ownerId"]);
    await audit(
      {
        action,
        entityType: "project",
        entityId: project.id,
        projectId: project.id,
        actorId: auth.user.id,
        metadata: { fields: Object.keys(input) },
        ...(diff ?? {}),
        ipAddress: meta.ip,
        requestId: meta.requestId,
      },
      tx,
    );
    return updated;
  });
}

/** Admin only: override the monthly AI token cap (null = use the default from AI settings). */
export async function setAiBudget(
  auth: AuthContext,
  projectId: string,
  monthlyTokenCap: number | null,
  meta: Meta,
): Promise<void> {
  const project = await requireProjectAccess(auth, projectId, "settings:manage", {
    allowArchived: true,
  });
  await db.$transaction(async (tx) => {
    await tx.project.update({ where: { id: projectId }, data: { monthlyTokenCap } });
    await audit(
      {
        action: "project.ai_budget",
        entityType: "project",
        entityId: projectId,
        projectId,
        actorId: auth.user.id,
        metadata: { monthlyTokenCap },
        before: { monthlyTokenCap: project.monthlyTokenCap },
        after: { monthlyTokenCap },
        ipAddress: meta.ip,
        requestId: meta.requestId,
      },
      tx,
    );
  });
}
