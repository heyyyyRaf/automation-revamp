import type { z } from "zod";
import type { Prisma, Project } from "@/generated/prisma/client";
import type { createProjectSchema, updateProjectSchema } from "@/lib/validation";
import type { AuthContext } from "@/server/auth/session";
import {
  accessibleProjectsWhere,
  requirePermission,
  requireProjectAccess,
} from "@/server/authz/guards";
import { db } from "@/server/db";
import { audit } from "@/server/services/audit";

interface Meta {
  ip: string;
  requestId: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  description: string | null;
  status: Project["status"];
  createdAt: Date;
  updatedAt: Date;
  documentCount: number;
  memberCount: number;
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
      _count: { select: { documents: { where: { deletedAt: null } }, members: true } },
    },
  });
  return rows.map(({ _count, ...p }) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    status: p.status,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    documentCount: _count.documents,
    memberCount: _count.members,
  }));
}

export async function createProject(
  auth: AuthContext,
  input: z.infer<typeof createProjectSchema>,
  meta: Meta,
): Promise<Project> {
  requirePermission(auth, "projects:create");
  return db.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        name: input.name,
        description: input.description || null,
        createdById: auth.user.id,
        members: { create: { userId: auth.user.id } },
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

export async function updateProject(
  auth: AuthContext,
  projectId: string,
  input: z.infer<typeof updateProjectSchema>,
  meta: Meta,
): Promise<Project> {
  const statusChange = input.status !== undefined;
  const fieldChange = input.name !== undefined || input.description !== undefined;
  // Archive/restore needs the archive permission and must work on archived projects.
  const project = await requireProjectAccess(
    auth,
    projectId,
    statusChange ? "projects:archive" : "projects:edit",
    { allowArchived: statusChange && !fieldChange },
  );

  const data: Prisma.ProjectUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description || null;
  if (input.status !== undefined && input.status !== project.status) {
    data.status = input.status;
    data.archivedAt = input.status === "ARCHIVED" ? new Date() : null;
  }

  return db.$transaction(async (tx) => {
    const updated = await tx.project.update({ where: { id: project.id }, data });
    const action =
      data.status === "ARCHIVED"
        ? "project.archive"
        : data.status === "ACTIVE"
          ? "project.restore"
          : "project.update";
    await audit(
      {
        action,
        entityType: "project",
        entityId: project.id,
        projectId: project.id,
        actorId: auth.user.id,
        metadata: { fields: Object.keys(input) },
        ipAddress: meta.ip,
        requestId: meta.requestId,
      },
      tx,
    );
    return updated;
  });
}

/** Admin only: override the monthly AI token cap (null = use the global default). */
export async function setAiBudget(
  auth: AuthContext,
  projectId: string,
  monthlyTokenCap: number | null,
  meta: Meta,
): Promise<void> {
  await requireProjectAccess(auth, projectId, "projects:edit", { allowArchived: true });
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
        ipAddress: meta.ip,
        requestId: meta.requestId,
      },
      tx,
    );
  });
}
