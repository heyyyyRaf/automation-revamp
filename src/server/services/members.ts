import type { AuthContext } from "@/server/auth/session";
import { isValidId, requireOwnerOrAdmin, requireProjectAccess } from "@/server/authz/guards";
import { db } from "@/server/db";
import { badRequest, conflict, notFound } from "@/server/errors";
import { audit } from "@/server/services/audit";

interface Meta {
  ip: string;
  requestId: string;
}

export async function listMembers(auth: AuthContext, projectId: string) {
  await requireProjectAccess(auth, projectId, "projects:read");
  const rows = await db.projectMember.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
    include: {
      user: { select: { id: true, name: true, email: true, role: true, isActive: true } },
    },
  });
  return rows.map((m) => ({ id: m.id, addedAt: m.createdAt, user: m.user }));
}

/** Owner or Admin (FR-1.1). Members must be active; a project's owner can't be removed. */
async function requireMemberManager(auth: AuthContext, projectId: string) {
  const project = await requireProjectAccess(auth, projectId, "projects:edit");
  requireOwnerOrAdmin(auth, project);
  return project;
}

export async function addMember(auth: AuthContext, projectId: string, userId: string, meta: Meta) {
  await requireMemberManager(auth, projectId);
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound("User");
  if (!user.isActive) throw badRequest("This user is deactivated.");

  const existing = await db.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
  });
  if (existing) throw conflict("This user is already a member of the project.");

  return db.$transaction(async (tx) => {
    const member = await tx.projectMember.create({ data: { projectId, userId } });
    await audit(
      {
        action: "member.add",
        entityType: "project_member",
        entityId: member.id,
        projectId,
        actorId: auth.user.id,
        metadata: { userId },
        ipAddress: meta.ip,
        requestId: meta.requestId,
      },
      tx,
    );
    return member;
  });
}

export async function removeMember(
  auth: AuthContext,
  projectId: string,
  userId: string,
  meta: Meta,
) {
  const project = await requireMemberManager(auth, projectId);
  if (!isValidId(userId)) throw notFound("Member");
  if (userId === project.ownerId) {
    throw conflict("This user owns the project. Make someone else the owner first.");
  }
  await db.$transaction(async (tx) => {
    const { count } = await tx.projectMember.deleteMany({ where: { projectId, userId } });
    if (count === 0) throw notFound("Member");
    await audit(
      {
        action: "member.remove",
        entityType: "project_member",
        projectId,
        actorId: auth.user.id,
        metadata: { userId },
        ipAddress: meta.ip,
        requestId: meta.requestId,
      },
      tx,
    );
  });
}
