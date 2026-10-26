import type { Prisma } from "@/generated/prisma/client";
import type { AuthContext } from "@/server/auth/session";
import { isValidId, requirePermission } from "@/server/authz/guards";
import { db } from "@/server/db";

export interface AuditQuery {
  projectId?: string | undefined;
  actorId?: string | undefined;
  /** An action or an action family, e.g. "testcase" or "testcase.approve". */
  action?: string | undefined;
  /** Cursor: the id of the last row of the previous page. */
  cursor?: string | undefined;
}

const PAGE = 50;
const ACTION_RE = /^[a-z_]{2,40}(\.[a-z_]{2,40})?$/;

/** FRD audit_log: who changed what, with before/after values. The Lead sees everything. */
export async function listAuditLog(auth: AuthContext, q: AuditQuery) {
  requirePermission(auth, "audit:read");
  const where: Prisma.AuditLogWhereInput = {
    ...(q.projectId && isValidId(q.projectId) ? { projectId: q.projectId } : {}),
    ...(q.actorId && isValidId(q.actorId) ? { actorId: q.actorId } : {}),
    ...(q.action && ACTION_RE.test(q.action)
      ? q.action.includes(".")
        ? { action: q.action }
        : { action: { startsWith: `${q.action}.` } }
      : {}),
  };
  const rows = await db.auditLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE + 1,
    ...(q.cursor && isValidId(q.cursor) ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      action: true,
      entityType: true,
      entityId: true,
      metadata: true,
      before: true,
      after: true,
      ipAddress: true,
      createdAt: true,
      actor: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
    },
  });
  return {
    entries: rows.slice(0, PAGE),
    nextCursor: rows.length > PAGE ? (rows[PAGE - 1]?.id ?? null) : null,
  };
}
