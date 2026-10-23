import type { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type {
  flowCreateSchema,
  flowUpdateSchema,
  questionCreateSchema,
  questionUpdateSchema,
  requirementCreateSchema,
  requirementUpdateSchema,
} from "@/lib/validation";
import type { AuthContext } from "@/server/auth/session";
import { isValidId, requireProjectAccess } from "@/server/authz/guards";
import { db } from "@/server/db";
import { badRequest, notFound } from "@/server/errors";
import { audit, type AuditAction } from "@/server/services/audit";
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
  ) =>
    audit({
      action,
      entityType,
      entityId,
      projectId,
      actorId: auth.user.id,
      ...(metadata ? { metadata } : {}),
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
      sourceDocument: { select: { id: true, originalName: true } },
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
    origin: r.origin,
    sourceSection: r.sourceSection,
    sourceDocument: r.sourceDocument,
    testCaseCount: testCases.length,
    approvedTestCaseCount: testCases.filter((t) => t.testCase.status === "APPROVED").length,
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
      },
    });
  });
  await auditFor(auth, projectId, meta)("requirement.create", "requirement", req.id, {
    key: req.key,
  });
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
    },
  });
  await auditFor(auth, projectId, meta)("requirement.update", "requirement", req.id, {
    key: req.key,
    fields: Object.keys(input),
  });
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
  await db.requirement.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });
  await auditFor(auth, projectId, meta)("requirement.delete", "requirement", existing.id, {
    key: existing.key,
  });
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
      requirement: { select: { id: true, key: true } },
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
  await auditFor(auth, projectId, meta)(
    input.answer !== undefined ? "question.answer" : "question.update",
    "open_question",
    q.id,
    { status: q.status },
  );
  return q;
}
