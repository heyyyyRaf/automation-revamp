import type { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type {
  flowCreateSchema,
  flowUpdateSchema,
  questionCreateSchema,
  questionUpdateSchema,
  requirementCreateSchema,
  requirementMergeSchema,
  requirementUpdateSchema,
} from "@/lib/validation";
import { APPROVED_LIKE } from "@/lib/domain";
import type { AuthContext } from "@/server/auth/session";
import { isValidId, requireProjectAccess } from "@/server/authz/guards";
import { db } from "@/server/db";
import { badRequest, notFound } from "@/server/errors";
import { audit, changes, type AuditAction } from "@/server/services/audit";
import { allocateKeys } from "@/server/services/keys";

interface Meta {
  ip: string;
  requestId: string;
}

function auditFor(auth: AuthContext, projectId: string, meta: Meta) {
  return (
    action: AuditAction,
    entityType: string,
    entityId: string,
    metadata?: Prisma.InputJsonObject,
    diff?: { before: Prisma.InputJsonObject; after: Prisma.InputJsonObject } | null,
  ) =>
    audit({
      action,
      entityType,
      entityId,
      projectId,
      actorId: auth.user.id,
      ...(metadata ? { metadata } : {}),
      ...(diff ?? {}),
      ipAddress: meta.ip,
      requestId: meta.requestId,
    });
}

// ── Requirements ────────────────────────────────────────────────────────────

export async function listRequirements(auth: AuthContext, projectId: string) {
  await requireProjectAccess(auth, projectId, "projects:read");
  const rows = await db.requirement.findMany({
    where: { projectId, deletedAt: null },
    orderBy: { key: "asc" },
    include: {
      sourceDocument: { select: { id: true, originalName: true, typeTag: true } },
      updatedBy: { select: { id: true, name: true } },
      testCases: {
        where: { testCase: { deletedAt: null } },
        select: { testCase: { select: { status: true } } },
      },
    },
  });
  return rows.map(({ testCases, ...r }) => ({
    id: r.id,
    key: r.key,
    text: r.text,
    type: r.type,
    status: r.status,
    origin: r.origin,
    sourceSection: r.sourceSection,
    sourceDocument: r.sourceDocument,
    testCaseCount: testCases.filter((t) => t.testCase.status !== "REJECTED").length,
    approvedTestCaseCount: testCases.filter((t) =>
      (APPROVED_LIKE as readonly string[]).includes(t.testCase.status),
    ).length,
    updatedBy: r.updatedBy,
    updatedAt: r.updatedAt,
  }));
}

export async function createRequirement(
  auth: AuthContext,
  projectId: string,
  input: z.infer<typeof requirementCreateSchema>,
  meta: Meta,
) {
  await requireProjectAccess(auth, projectId, "requirements:write");
  const req = await db.$transaction(async (tx) => {
    const [key] = await allocateKeys(tx, projectId, "REQ", 1);
    return tx.requirement.create({
      data: {
        projectId,
        key: key ?? "",
        text: input.text,
        type: input.type,
        sourceSection: input.sourceSection ?? null,
        origin: "MANUAL",
        updatedById: auth.user.id,
      },
    });
  });
  await auditFor(auth, projectId, meta)(
    "requirement.create",
    "requirement",
    req.id,
    { key: req.key },
    { before: {}, after: { text: req.text, type: req.type } },
  );
  return req;
}

async function findRequirement(projectId: string, id: string) {
  if (!isValidId(id)) throw notFound("Requirement");
  const req = await db.requirement.findFirst({ where: { id, projectId, deletedAt: null } });
  if (!req) throw notFound("Requirement");
  return req;
}

export async function updateRequirement(
  auth: AuthContext,
  projectId: string,
  id: string,
  input: z.infer<typeof requirementUpdateSchema>,
  meta: Meta,
) {
  await requireProjectAccess(auth, projectId, "requirements:write");
  const existing = await findRequirement(projectId, id);
  const req = await db.requirement.update({
    where: { id: existing.id },
    data: {
      ...(input.text !== undefined ? { text: input.text } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.sourceSection !== undefined ? { sourceSection: input.sourceSection } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      updatedById: auth.user.id,
    },
  });
  await auditFor(auth, projectId, meta)(
    "requirement.update",
    "requirement",
    req.id,
    { key: req.key, fields: Object.keys(input) },
    changes(existing, req, ["text", "type", "sourceSection", "status"]),
  );
  return req;
}

/** Soft delete: linked test cases keep their history; the requirement leaves the scope. */
export async function deleteRequirement(
  auth: AuthContext,
  projectId: string,
  id: string,
  meta: Meta,
) {
  await requireProjectAccess(auth, projectId, "requirements:write");
  const existing = await findRequirement(projectId, id);
  await db.requirement.update({
    where: { id: existing.id },
    data: { deletedAt: new Date(), updatedById: auth.user.id },
  });
  await auditFor(auth, projectId, meta)(
    "requirement.delete",
    "requirement",
    existing.id,
    { key: existing.key },
    { before: { text: existing.text, type: existing.type }, after: {} },
  );
}

/**
 * FR-3.4: merges duplicates into one requirement. The lowest-numbered one survives with the
 * merged wording; the others are marked MERGED (pointing at it) and leave the list. Their
 * test case links and open questions move to the survivor, so traceability is kept.
 */
export async function mergeRequirements(
  auth: AuthContext,
  projectId: string,
  input: z.infer<typeof requirementMergeSchema>,
  meta: Meta,
) {
  await requireProjectAccess(auth, projectId, "requirements:write");
  const ids = [...new Set(input.requirementIds)];
  if (ids.length < 2) throw badRequest("Choose at least two different requirements.");
  const reqs = await db.requirement.findMany({
    where: { id: { in: ids }, projectId, deletedAt: null },
    orderBy: { key: "asc" },
  });
  if (reqs.length !== ids.length) throw notFound("Requirement");
  const [survivor, ...others] = reqs;
  if (!survivor) throw notFound("Requirement");
  const otherIds = others.map((r) => r.id);

  const merged = await db.$transaction(async (tx) => {
    const links = await tx.testCaseRequirement.findMany({
      where: { requirementId: { in: otherIds } },
      select: { testCaseId: true },
    });
    if (links.length > 0) {
      await tx.testCaseRequirement.createMany({
        data: links.map((l) => ({ testCaseId: l.testCaseId, requirementId: survivor.id })),
        skipDuplicates: true,
      });
      await tx.testCaseRequirement.deleteMany({ where: { requirementId: { in: otherIds } } });
    }
    await tx.openQuestion.updateMany({
      where: { projectId, requirementId: { in: otherIds } },
      data: { requirementId: survivor.id },
    });
    await tx.requirement.updateMany({
      where: { id: { in: otherIds } },
      data: {
        status: "MERGED",
        mergedIntoId: survivor.id,
        deletedAt: new Date(),
        updatedById: auth.user.id,
      },
    });
    const updated = await tx.requirement.update({
      where: { id: survivor.id },
      data: { text: input.text, type: input.type, updatedById: auth.user.id },
    });
    await audit(
      {
        action: "requirement.merge",
        entityType: "requirement",
        entityId: survivor.id,
        projectId,
        actorId: auth.user.id,
        metadata: { into: survivor.key, merged: others.map((r) => r.key) },
        before: {
          requirements: reqs.map((r) => ({ key: r.key, text: r.text, type: r.type })),
        },
        after: { key: updated.key, text: updated.text, type: updated.type },
        ipAddress: meta.ip,
        requestId: meta.requestId,
      },
      tx,
    );
    return updated;
  });
  return merged;
}

/** A requirement flagged by an open question goes back to Active once none are open. */
async function settleReviewStatus(projectId: string, requirementId: string | null) {
  if (!requirementId) return;
  const open = await db.openQuestion.count({
    where: { projectId, requirementId, status: "OPEN" },
  });
  if (open === 0) {
    await db.requirement.updateMany({
      where: { id: requirementId, projectId, status: "NEEDS_REVIEW" },
      data: { status: "ACTIVE" },
    });
  }
}

// ── User flows ──────────────────────────────────────────────────────────────

export async function listFlows(auth: AuthContext, projectId: string) {
  await requireProjectAccess(auth, projectId, "projects:read");
  const rows = await db.userFlow.findMany({
    where: { projectId, deletedAt: null },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((f) => ({
    id: f.id,
    name: f.name,
    description: f.description,
    steps: Array.isArray(f.steps) ? f.steps.map(String) : [],
    origin: f.origin,
  }));
}

export async function createFlow(
  auth: AuthContext,
  projectId: string,
  input: z.infer<typeof flowCreateSchema>,
  meta: Meta,
) {
  await requireProjectAccess(auth, projectId, "requirements:write");
  const flow = await db.userFlow.create({
    data: {
      projectId,
      name: input.name,
      description: input.description ?? null,
      steps: input.steps,
      origin: "MANUAL",
    },
  });
  await auditFor(auth, projectId, meta)("flow.create", "user_flow", flow.id);
  return flow;
}

async function findFlow(projectId: string, id: string) {
  if (!isValidId(id)) throw notFound("Flow");
  const flow = await db.userFlow.findFirst({ where: { id, projectId, deletedAt: null } });
  if (!flow) throw notFound("Flow");
  return flow;
}

export async function updateFlow(
  auth: AuthContext,
  projectId: string,
  id: string,
  input: z.infer<typeof flowUpdateSchema>,
  meta: Meta,
) {
  await requireProjectAccess(auth, projectId, "requirements:write");
  const existing = await findFlow(projectId, id);
  const flow = await db.userFlow.update({
    where: { id: existing.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.steps !== undefined ? { steps: input.steps } : {}),
    },
  });
  await auditFor(auth, projectId, meta)("flow.update", "user_flow", flow.id);
  return flow;
}

export async function deleteFlow(auth: AuthContext, projectId: string, id: string, meta: Meta) {
  await requireProjectAccess(auth, projectId, "requirements:write");
  const existing = await findFlow(projectId, id);
  await db.userFlow.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });
  await auditFor(auth, projectId, meta)("flow.delete", "user_flow", existing.id);
}

// ── Open questions ──────────────────────────────────────────────────────────

export async function listQuestions(auth: AuthContext, projectId: string) {
  await requireProjectAccess(auth, projectId, "projects:read");
  return db.openQuestion.findMany({
    where: { projectId },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      question: true,
      answer: true,
      status: true,
      origin: true,
      answeredAt: true,
      // "From FRD section 4.2": where the unclear requirement came from (design: Upload).
      requirement: {
        select: {
          id: true,
          key: true,
          sourceSection: true,
          sourceDocument: { select: { originalName: true } },
        },
      },
      answeredBy: { select: { name: true } },
    },
  });
}

export async function createQuestion(
  auth: AuthContext,
  projectId: string,
  input: z.infer<typeof questionCreateSchema>,
  meta: Meta,
) {
  await requireProjectAccess(auth, projectId, "requirements:write");
  if (input.requirementId) await findRequirement(projectId, input.requirementId);
  const q = await db.openQuestion.create({
    data: {
      projectId,
      question: input.question,
      requirementId: input.requirementId ?? null,
      origin: "MANUAL",
    },
  });
  await auditFor(auth, projectId, meta)("question.create", "open_question", q.id);
  return q;
}

export async function updateQuestion(
  auth: AuthContext,
  projectId: string,
  id: string,
  input: z.infer<typeof questionUpdateSchema>,
  meta: Meta,
) {
  await requireProjectAccess(auth, projectId, "requirements:write");
  if (!isValidId(id)) throw notFound("Question");
  const existing = await db.openQuestion.findFirst({ where: { id, projectId } });
  if (!existing) throw notFound("Question");
  if (input.answer !== undefined && input.status !== undefined) {
    throw badRequest("Answer a question or change its status, not both at once.");
  }
  const data: Prisma.OpenQuestionUpdateInput =
    input.answer !== undefined
      ? {
          answer: input.answer,
          status: "ANSWERED",
          answeredAt: new Date(),
          answeredBy: { connect: { id: auth.user.id } },
        }
      : { status: input.status ?? existing.status };
  const q = await db.openQuestion.update({ where: { id: existing.id }, data });
  await settleReviewStatus(projectId, q.requirementId);
  await auditFor(auth, projectId, meta)(
    input.answer !== undefined ? "question.answer" : "question.update",
    "open_question",
    q.id,
    { status: q.status },
  );
  return q;
}
