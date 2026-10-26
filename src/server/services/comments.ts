import type { z } from "zod";
import type { CommentTarget } from "@/generated/prisma/client";
import type { commentCreateSchema } from "@/lib/validation";
import type { AuthContext } from "@/server/auth/session";
import { isValidId, requireProjectAccess } from "@/server/authz/guards";
import { db } from "@/server/db";
import { notFound } from "@/server/errors";
import { audit } from "@/server/services/audit";

interface Meta {
  ip: string;
  requestId: string;
}

/** The commented item must belong to the project (IDs from other projects are "not found"). */
async function assertTarget(projectId: string, targetType: CommentTarget, targetId: string) {
  if (!isValidId(targetId)) throw notFound("Item");
  const found =
    targetType === "TEST_CASE"
      ? await db.testCase.count({ where: { id: targetId, projectId, deletedAt: null } })
      : await db.run.count({ where: { id: targetId, projectId } });
  if (!found) throw notFound(targetType === "TEST_CASE" ? "Test case" : "Run");
}

export async function listComments(
  auth: AuthContext,
  projectId: string,
  targetType: CommentTarget,
  targetId: string,
) {
  await requireProjectAccess(auth, projectId, "projects:read");
  await assertTarget(projectId, targetType, targetId);
  const rows = await db.comment.findMany({
    where: { projectId, targetType, targetId },
    orderBy: { createdAt: "asc" },
    take: 500,
    include: { author: { select: { id: true, name: true, role: true } } },
  });
  return rows.map((c) => ({ id: c.id, body: c.body, author: c.author, createdAt: c.createdAt }));
}

/** Comments on test cases and runs (FRD roles: every role, Viewers included, may comment). */
export async function createComment(
  auth: AuthContext,
  projectId: string,
  input: z.infer<typeof commentCreateSchema>,
  meta: Meta,
) {
  // A comment doesn't change the project, so it is allowed on archived projects too.
  await requireProjectAccess(auth, projectId, "comments:create", { allowArchived: true });
  await assertTarget(projectId, input.targetType, input.targetId);
  const c = await db.comment.create({
    data: {
      projectId,
      targetType: input.targetType,
      targetId: input.targetId,
      authorId: auth.user.id,
      body: input.body,
    },
    include: { author: { select: { id: true, name: true, role: true } } },
  });
  await audit({
    action: "comment.create",
    entityType: input.targetType === "TEST_CASE" ? "test_case" : "run",
    entityId: input.targetId,
    projectId,
    actorId: auth.user.id,
    metadata: { commentId: c.id },
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });
  return { id: c.id, body: c.body, author: c.author, createdAt: c.createdAt };
}
