import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { logger } from "@/server/logger";

export type AuditAction =
  | "auth.login"
  | "auth.login_failed"
  | "auth.logout"
  | "user.create"
  | "user.update"
  | "user.password_reset"
  | "project.create"
  | "project.update"
  | "project.archive"
  | "project.restore"
  | "member.add"
  | "member.remove"
  | "document.upload"
  | "document.delete"
  | "ai.analyze_requested"
  | "ai.analyze"
  | "ai.generate_requested"
  | "ai.generate_test_cases"
  | "requirement.create"
  | "requirement.update"
  | "requirement.delete"
  | "flow.create"
  | "flow.update"
  | "flow.delete"
  | "question.create"
  | "question.answer"
  | "question.update"
  | "testcase.create"
  | "testcase.update"
  | "testcase.delete"
  | "testcase.approve"
  | "testcase.reject"
  | "testcase.reopen"
  | "project.ai_budget"
  | "export.create"
  | "export.download";

export interface AuditEntry {
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  projectId?: string | null;
  actorId?: string | null;
  metadata?: Prisma.InputJsonObject;
  ipAddress?: string;
  requestId?: string;
}

type Tx = Pick<Prisma.TransactionClient, "auditLog">;

/**
 * Writes an audit record. Pass `tx` to make it part of the same transaction as the change.
 * Callers must never put secrets in `metadata`.
 */
export async function audit(entry: AuditEntry, tx: Tx = db): Promise<void> {
  try {
    await tx.auditLog.create({
      data: {
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        projectId: entry.projectId ?? null,
        actorId: entry.actorId ?? null,
        metadata: entry.metadata ?? {},
        ipAddress: entry.ipAddress ?? null,
        requestId: entry.requestId ?? null,
      },
    });
  } catch (err) {
    // Inside a transaction, let the failure roll the change back.
    if (tx !== db) throw err;
    logger.error({ err, action: entry.action }, "failed to write audit log");
  }
}
