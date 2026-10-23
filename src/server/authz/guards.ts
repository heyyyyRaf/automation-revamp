import type { Prisma, Project } from "@/generated/prisma/client";
import { can, type Permission } from "@/lib/permissions";
import type { AuthContext } from "@/server/auth/session";
import { db } from "@/server/db";
import { conflict, forbidden, notFound } from "@/server/errors";

const ID_RE = /^[a-z0-9]{20,40}$/;

export function requirePermission(auth: AuthContext, permission: Permission): void {
  if (!can(auth.user.role, permission)) throw forbidden();
}

/** WHERE clause limiting projects to those the caller may see. Use for every project list query. */
export function accessibleProjectsWhere(auth: AuthContext): Prisma.ProjectWhereInput {
  if (auth.user.role === "ADMIN") return {};
  return { members: { some: { userId: auth.user.id } } };
}

/**
 * The single entry point for project-scoped routes. Returns 404 (not 403) when the caller
 * is not a member, so project IDs from other teams cannot be probed.
 */
export async function requireProjectAccess(
  auth: AuthContext,
  projectId: string,
  permission: Permission,
  options: { allowArchived?: boolean } = {},
): Promise<Project> {
  if (!ID_RE.test(projectId)) throw notFound("Project");
  const project = await db.project.findFirst({
    where: { id: projectId, ...accessibleProjectsWhere(auth) },
  });
  if (!project) throw notFound("Project");
  requirePermission(auth, permission);

  const isRead = permission.endsWith(":read");
  if (project.status === "ARCHIVED" && !isRead && !options.allowArchived) {
    throw conflict("This project is archived. Restore it before making changes.");
  }
  return project;
}

export function isValidId(id: string): boolean {
  return ID_RE.test(id);
}
