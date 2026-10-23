import type { z } from "zod";
import type { Prisma, ReviewStatus } from "@/generated/prisma/client";
import type {
  testCaseCreateSchema,
  testCaseReviewSchema,
  testCaseUpdateSchema,
} from "@/lib/validation";
import type { AuthContext } from "@/server/auth/session";
import { isValidId, requireProjectAccess } from "@/server/authz/guards";
import { db } from "@/server/db";
import { badRequest, notFound } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { allocateKeys } from "@/server/services/keys";

interface Meta {
  ip: string;
  requestId: string;
}

const TEST_CASE_INCLUDE = {
  reviewedBy: { select: { name: true } },
  requirements: {
    where: { requirement: { deletedAt: null } },
    select: { requirement: { select: { id: true, key: true, text: true } } },
  },
} satisfies Prisma.TestCaseInclude;

type Row = Prisma.TestCaseGetPayload<{ include: typeof TEST_CASE_INCLUDE }>;

function toDto(t: Row) {
  return {
    id: t.id,
    key: t.key,
    title: t.title,
    preconditions: t.preconditions,
    steps: (Array.isArray(t.steps) ? t.steps : []) as {
      action: string;
      expected?: string | null;
    }[],
    testData: Object.entries((t.testData as Record<string, string> | null) ?? {}).map(
      ([name, value]) => ({
        name,
        value: String(value),
      }),
    ),
    expectedResult: t.expectedResult,
    type: t.type,
    priority: t.priority,
    automatable: t.automatable,
    automatableReason: t.automatableReason,
    origin: t.origin,
    status: t.status,
    reviewedBy: t.reviewedBy?.name ?? null,
    reviewedAt: t.reviewedAt,
    rejectionReason: t.rejectionReason,
    requirements: t.requirements.map((r) => r.requirement),
    updatedAt: t.updatedAt,
  };
}

export type TestCaseDto = ReturnType<typeof toDto>;

export interface TestCaseFilters {
  status?: ReviewStatus | undefined;
  requirementId?: string | undefined;
}

export async function listTestCases(
  auth: AuthContext,
  projectId: string,
  filters: TestCaseFilters = {},
) {
  await requireProjectAccess(auth, projectId, "projects:read");
  const rows = await db.testCase.findMany({
    where: {
      projectId,
      deletedAt: null,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.requirementId && isValidId(filters.requirementId)
        ? { requirements: { some: { requirementId: filters.requirementId } } }
        : {}),
    },
    orderBy: { key: "asc" },
    include: TEST_CASE_INCLUDE,
  });
  return rows.map(toDto);
}

async function assertRequirementsInProject(projectId: string, ids: string[]): Promise<void> {
  const unique = [...new Set(ids)];
  const count = await db.requirement.count({
    where: { id: { in: unique }, projectId, deletedAt: null },
  });
  if (count !== unique.length)
    throw badRequest("Some linked requirements don't exist in this project.");
}

const testDataObject = (items: { name: string; value: string }[] | undefined) =>
  Object.fromEntries((items ?? []).map((d) => [d.name, d.value]));

export async function createTestCase(
  auth: AuthContext,
  projectId: string,
  input: z.infer<typeof testCaseCreateSchema>,
  meta: Meta,
): Promise<TestCaseDto> {
  await requireProjectAccess(auth, projectId, "testcases:write");
  await assertRequirementsInProject(projectId, input.requirementIds);
  const created = await db.$transaction(async (tx) => {
    const [key] = await allocateKeys(tx, projectId, "TC", 1);
    return tx.testCase.create({
      data: {
        projectId,
        key: key ?? "",
        title: input.title,
        preconditions: input.preconditions ?? null,
        steps: input.steps.map((s) => ({ action: s.action, expected: s.expected ?? null })),
        testData: testDataObject(input.testData),
        expectedResult: input.expectedResult,
        type: input.type,
        priority: input.priority,
        automatable: input.automatable,
        automatableReason: input.automatableReason ?? null,
        origin: "MANUAL",
        requirements: {
          create: [...new Set(input.requirementIds)].map((requirementId) => ({ requirementId })),
        },
      },
      include: TEST_CASE_INCLUDE,
    });
  });
  await audit({
    action: "testcase.create",
    entityType: "test_case",
    entityId: created.id,
    projectId,
    actorId: auth.user.id,
    metadata: { key: created.key },
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });
  return toDto(created);
}

async function findTestCase(projectId: string, id: string) {
  if (!isValidId(id)) throw notFound("Test case");
  const tc = await db.testCase.findFirst({ where: { id, projectId, deletedAt: null } });
  if (!tc) throw notFound("Test case");
  return tc;
}

export async function getTestCase(
  auth: AuthContext,
  projectId: string,
  id: string,
): Promise<TestCaseDto> {
  await requireProjectAccess(auth, projectId, "projects:read");
  await findTestCase(projectId, id);
  return toDto(await db.testCase.findUniqueOrThrow({ where: { id }, include: TEST_CASE_INCLUDE }));
}

/** Any edit sends an approved/rejected test case back to DRAFT: it must be re-approved. */
export async function updateTestCase(
  auth: AuthContext,
  projectId: string,
  id: string,
  input: z.infer<typeof testCaseUpdateSchema>,
  meta: Meta,
): Promise<TestCaseDto> {
  await requireProjectAccess(auth, projectId, "testcases:write");
  const existing = await findTestCase(projectId, id);
  if (input.requirementIds) await assertRequirementsInProject(projectId, input.requirementIds);

  const data: Prisma.TestCaseUpdateInput = {
    status: "DRAFT",
    reviewedBy: { disconnect: true },
    reviewedAt: null,
    rejectionReason: null,
  };
  if (input.title !== undefined) data.title = input.title;
  if (input.preconditions !== undefined) data.preconditions = input.preconditions;
  if (input.steps !== undefined)
    data.steps = input.steps.map((s) => ({ action: s.action, expected: s.expected ?? null }));
  if (input.testData !== undefined) data.testData = testDataObject(input.testData);
  if (input.expectedResult !== undefined) data.expectedResult = input.expectedResult;
  if (input.type !== undefined) data.type = input.type;
  if (input.priority !== undefined) data.priority = input.priority;
  if (input.automatable !== undefined) data.automatable = input.automatable;
  if (input.automatableReason !== undefined) data.automatableReason = input.automatableReason;

  const updated = await db.$transaction(async (tx) => {
    if (input.requirementIds) {
      await tx.testCaseRequirement.deleteMany({ where: { testCaseId: existing.id } });
      await tx.testCaseRequirement.createMany({
        data: [...new Set(input.requirementIds)].map((requirementId) => ({
          testCaseId: existing.id,
          requirementId,
        })),
      });
    }
    return tx.testCase.update({ where: { id: existing.id }, data, include: TEST_CASE_INCLUDE });
  });
  await audit({
    action: "testcase.update",
    entityType: "test_case",
    entityId: existing.id,
    projectId,
    actorId: auth.user.id,
    metadata: { key: existing.key, fields: Object.keys(input), previousStatus: existing.status },
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });
  return toDto(updated);
}

export async function deleteTestCase(auth: AuthContext, projectId: string, id: string, meta: Meta) {
  await requireProjectAccess(auth, projectId, "testcases:write");
  const existing = await findTestCase(projectId, id);
  await db.testCase.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });
  await audit({
    action: "testcase.delete",
    entityType: "test_case",
    entityId: existing.id,
    projectId,
    actorId: auth.user.id,
    metadata: { key: existing.key },
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });
}

export async function reviewTestCases(
  auth: AuthContext,
  projectId: string,
  input: z.infer<typeof testCaseReviewSchema>,
  meta: Meta,
): Promise<{ updated: number }> {
  await requireProjectAccess(auth, projectId, "testcases:review");
  const ids = [...new Set(input.testCaseIds)];
  const rows = await db.testCase.findMany({
    where: { id: { in: ids }, projectId, deletedAt: null },
    select: { id: true, key: true },
  });
  // All-or-nothing: an ID from another project makes the whole request fail.
  if (rows.length !== ids.length) throw notFound("Test case");

  const now = new Date();
  const data: Prisma.TestCaseUncheckedUpdateManyInput =
    input.decision === "APPROVE"
      ? { status: "APPROVED", reviewedById: auth.user.id, reviewedAt: now, rejectionReason: null }
      : input.decision === "REJECT"
        ? {
            status: "REJECTED",
            reviewedById: auth.user.id,
            reviewedAt: now,
            rejectionReason: input.reason ?? "",
          }
        : { status: "DRAFT", reviewedById: null, reviewedAt: null, rejectionReason: null };
  const action =
    input.decision === "APPROVE"
      ? "testcase.approve"
      : input.decision === "REJECT"
        ? "testcase.reject"
        : "testcase.reopen";

  await db.$transaction(async (tx) => {
    await tx.testCase.updateMany({ where: { id: { in: ids }, projectId }, data });
    for (const r of rows) {
      await audit(
        {
          action,
          entityType: "test_case",
          entityId: r.id,
          projectId,
          actorId: auth.user.id,
          metadata: { key: r.key, ...(input.reason ? { reason: input.reason } : {}) },
          ipAddress: meta.ip,
          requestId: meta.requestId,
        },
        tx,
      );
    }
  });
  return { updated: rows.length };
}
