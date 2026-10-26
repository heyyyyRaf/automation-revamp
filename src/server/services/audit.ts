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
  | "document.update"
  | "document.delete"
  | "ai.analyze_requested"
  | "ai.analyze"
  | "ai.generate_requested"
  | "ai.generate_test_cases"
  | "ai.rewrite_requested"
  | "requirement.create"
  | "requirement.update"
  | "requirement.delete"
  | "requirement.merge"
  | "flow.create"
  | "flow.update"
  | "flow.delete"
  | "scenario.create"
  | "scenario.update"
  | "question.create"
  | "question.answer"
  | "question.update"
  | "testcase.create"
  | "testcase.update"
  | "testcase.delete"
  | "testcase.approve"
  | "testcase.reject"
  | "testcase.reopen"
  | "testcase.rewrite"
  | "testcase.export"
  | "comment.create"
  | "settings.update"
  | "project.ai_budget"
  | "export.create"
  | "export.download"
  | "target.request"
  | "target.approve"
  | "target.revoke"
  | "environment.create"
  | "environment.update"
  | "environment.delete"
  | "environment.verify_login"
  | "account.create"
  | "account.update"
  | "account.delete"
  | "script.generate_requested"
  | "script.version_create"
  | "script.fix_requested"
  | "script.approve"
  | "script.revoke"
  | "script.download"
  | "run.start"
  | "run.control"
  | "run.download";

export interface AuditEntry {
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  projectId?: string | null;
  actorId?: string | null;
  metadata?: Prisma.InputJsonObject;
  /** The changed fields as they were and as they became (FRD audit_log). Never secrets. */
  before?: Prisma.InputJsonObject | null;
  after?: Prisma.InputJsonObject | null;
  ipAddress?: string | undefined;
  requestId?: string | undefined;
}

type Tx = Pick<Prisma.TransactionClient, "auditLog">;

/**
 * Writes an audit record. Pass `tx` to make it part of the same transaction as the change.
 * Callers must never put secrets in `metadata`, `before` or `after`.
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
        ...(entry.before ? { before: entry.before } : {}),
        ...(entry.after ? { after: entry.after } : {}),
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

/**
 * Before/after snapshots of only the fields that changed, ready for `audit()`.
 * Values are JSON-normalised (dates become ISO strings).
 */
export function changes(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: readonly string[],
): { before: Prisma.InputJsonObject; after: Prisma.InputJsonObject } | null {
  const b: Record<string, Prisma.InputJsonValue | null> = {};
  const a: Record<string, Prisma.InputJsonValue | null> = {};
  for (const f of fields) {
    const was = normalise(before[f]);
    const now = normalise(after[f]);
    if (JSON.stringify(was) !== JSON.stringify(now)) {
      b[f] = was;
      a[f] = now;
    }
  }
  return Object.keys(a).length ? { before: b, after: a } : null;
}

function normalise(v: unknown): Prisma.InputJsonValue | null {
  if (v === undefined || v === null) return null;
  return JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
}
