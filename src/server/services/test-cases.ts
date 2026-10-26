import type { z } from "zod";
import writeXlsxFile, { type Row as XlsxRow } from "write-excel-file/node";
import type { Prisma, TestCaseStatus, TestCaseType } from "@/generated/prisma/client";
import { APPROVED_LIKE, TEST_CASE_STATUS_LABELS, TEST_CASE_TYPE_LABELS } from "@/lib/domain";
import type {
  testCaseCreateSchema,
  testCaseReviewSchema,
  testCaseUpdateSchema,
} from "@/lib/validation";
import type { AuthContext } from "@/server/auth/session";
import { isValidId, requireProjectAccess } from "@/server/authz/guards";
import { db } from "@/server/db";
import { badRequest, conflict, notFound } from "@/server/errors";
import { safeCell } from "@/server/exports/test-scope";
import { audit, changes } from "@/server/services/audit";
import { allocateKeys } from "@/server/services/keys";
import { withdrawScriptApproval } from "@/server/scripts/pipeline";

interface Meta {
  ip: string;
  requestId: string;
}

const TEST_CASE_INCLUDE = {
  reviewedBy: { select: { name: true } },
  updatedBy: { select: { name: true } },
  scenario: { select: { id: true, key: true, title: true } },
  requirements: {
    where: { requirement: { deletedAt: null } },
    select: {
      requirement: {
        select: {
          id: true,
          key: true,
          text: true,
          sourceSection: true,
          sourceDocument: { select: { id: true, originalName: true } },
        },
      },
    },
  },
} satisfies Prisma.TestCaseInclude;

type Row = Prisma.TestCaseGetPayload<{ include: typeof TEST_CASE_INCLUDE }>;

function toDto(t: Row) {
  const requirements = t.requirements.map((r) => r.requirement);
  return {
    id: t.id,
    key: t.key,
    title: t.title,
    scenario: t.scenario,
    preconditions: t.preconditions,
    steps: (Array.isArray(t.steps) ? t.steps : []) as {
      action: string;
      expected?: string | null;
    }[],
    testData: Object.entries((t.testData as Record<string, string> | null) ?? {}).map(
      ([name, value]) => ({ name, value: String(value) }),
    ),
    expectedResult: t.expectedResult,
    type: t.type,
    priority: t.priority,
    automatable: t.automatable,
    automatableReason: t.automatableReason,
    tags: t.tags,
    origin: t.origin,
    status: t.status,
    reviewedBy: t.reviewedBy?.name ?? null,
    reviewedAt: t.reviewedAt,
    rejectionReason: t.rejectionReason,
    requirements: requirements.map(({ id, key, text }) => ({ id, key, text })),
    /** NFR-7: where each linked requirement came from, so a reviewer can check it. */
    sources: requirements
      .filter((r) => r.sourceDocument)
      .map((r) => ({
        requirementKey: r.key,
        document: r.sourceDocument?.originalName ?? "",
        documentId: r.sourceDocument?.id ?? "",
        section: r.sourceSection,
      })),
    updatedBy: t.updatedBy?.name ?? null,
    updatedAt: t.updatedAt,
  };
}

export type TestCaseDto = ReturnType<typeof toDto>;

export interface TestCaseFilters {
  status?: TestCaseStatus | undefined;
  requirementId?: string | undefined;
  scenarioId?: string | undefined;
  type?: TestCaseType | undefined;
  /** Design filter "Manual only": cases a browser can't check. */
  manualOnly?: boolean | undefined;
  tag?: string | undefined;
}

function filterWhere(projectId: string, filters: TestCaseFilters): Prisma.TestCaseWhereInput {
  return {
    projectId,
    deletedAt: null,
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.requirementId && isValidId(filters.requirementId)
      ? { requirements: { some: { requirementId: filters.requirementId } } }
      : {}),
    ...(filters.scenarioId && isValidId(filters.scenarioId)
      ? { scenarioId: filters.scenarioId }
      : {}),
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.manualOnly ? { automatable: false } : {}),
    ...(filters.tag ? { tags: { has: filters.tag.toLowerCase() } } : {}),
  };
}

export async function listTestCases(
  auth: AuthContext,
  projectId: string,
  filters: TestCaseFilters = {},
) {
  await requireProjectAccess(auth, projectId, "projects:read");
  const rows = await db.testCase.findMany({
    where: filterWhere(projectId, filters),
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

async function assertScenarioInProject(projectId: string, id: string): Promise<void> {
  const found = await db.scenario.count({ where: { id, projectId, deletedAt: null } });
  if (!found) throw badRequest("Choose a scenario from this project.");
}

const testDataObject = (items: { name: string; value: string }[] | undefined) =>
  Object.fromEntries((items ?? []).map((d) => [d.name, d.value]));

const normTags = (tags: string[] | undefined) => [
  ...new Set((tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean)),
];

/** Fields compared for the audit log's before/after. */
const AUDITED = [
  "title",
  "scenarioId",
  "preconditions",
  "steps",
  "testData",
  "expectedResult",
  "type",
  "priority",
  "automatable",
  "automatableReason",
  "tags",
  "status",
] as const;

export async function createTestCase(
  auth: AuthContext,
  projectId: string,
  input: z.infer<typeof testCaseCreateSchema>,
  meta: Meta,
): Promise<TestCaseDto> {
  await requireProjectAccess(auth, projectId, "testcases:write");
  await assertRequirementsInProject(projectId, input.requirementIds);
  await assertScenarioInProject(projectId, input.scenarioId);
  const created = await db.$transaction(async (tx) => {
    const [key] = await allocateKeys(tx, projectId, "TC", 1);
    const tc = await tx.testCase.create({
      data: {
        projectId,
        key: key ?? "",
        title: input.title,
        scenarioId: input.scenarioId,
        preconditions: input.preconditions,
        steps: input.steps.map((s) => ({ action: s.action, expected: s.expected ?? null })),
        testData: testDataObject(input.testData),
        expectedResult: input.expectedResult,
        type: input.type,
        priority: input.priority,
        automatable: input.automatable,
        automatableReason: input.automatableReason,
        tags: normTags(input.tags),
        origin: "MANUAL",
        createdById: auth.user.id,
        updatedById: auth.user.id,
        requirements: {
          create: [...new Set(input.requirementIds)].map((requirementId) => ({ requirementId })),
        },
      },
      include: TEST_CASE_INCLUDE,
    });
    await audit(
      {
        action: "testcase.create",
        entityType: "test_case",
        entityId: tc.id,
        projectId,
        actorId: auth.user.id,
        metadata: { key: tc.key },
        after: { title: tc.title, type: tc.type, priority: tc.priority },
        ipAddress: meta.ip,
        requestId: meta.requestId,
      },
      tx,
    );
    return tc;
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

/**
 * FRD lifecycle: an edited case goes back to Draft and must be approved again (its script
 * approval no longer applies). Editing a Rejected case brings it back into the cycle.
 */
export async function updateTestCase(
  auth: AuthContext,
  projectId: string,
  id: string,
  input: z.infer<typeof testCaseUpdateSchema>,
  meta: Meta,
  options: {
    action?: "testcase.update" | "testcase.rewrite";
    metadata?: Prisma.InputJsonObject;
  } = {},
): Promise<TestCaseDto> {
  await requireProjectAccess(auth, projectId, "testcases:write");
  const existing = await findTestCase(projectId, id);
  if (input.requirementIds) await assertRequirementsInProject(projectId, input.requirementIds);
  if (input.scenarioId) await assertScenarioInProject(projectId, input.scenarioId);

  const data: Prisma.TestCaseUncheckedUpdateInput = {
    status: "DRAFT",
    reviewedById: null,
    reviewedAt: null,
    rejectionReason: null,
    updatedById: auth.user.id,
  };
  if (input.title !== undefined) data.title = input.title;
  if (input.scenarioId !== undefined) data.scenarioId = input.scenarioId;
  if (input.preconditions !== undefined) data.preconditions = input.preconditions;
  if (input.steps !== undefined)
    data.steps = input.steps.map((s) => ({ action: s.action, expected: s.expected ?? null }));
  if (input.testData !== undefined) data.testData = testDataObject(input.testData);
  if (input.expectedResult !== undefined) data.expectedResult = input.expectedResult;
  if (input.type !== undefined) data.type = input.type;
  if (input.priority !== undefined) data.priority = input.priority;
  if (input.automatable !== undefined) data.automatable = input.automatable;
  if (input.automatableReason !== undefined) data.automatableReason = input.automatableReason;
  if (input.tags !== undefined) data.tags = normTags(input.tags);

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
    const tc = await tx.testCase.update({
      where: { id: existing.id },
      data,
      include: TEST_CASE_INCLUDE,
    });
    // The case changed, so its approved script may no longer match it: re-approve both.
    const scriptWithdrawn = await withdrawScriptApproval(tx, existing.id);
    const diff = changes(existing, tc, AUDITED);
    await audit(
      {
        action: options.action ?? "testcase.update",
        entityType: "test_case",
        entityId: existing.id,
        projectId,
        actorId: auth.user.id,
        metadata: {
          key: existing.key,
          fields: Object.keys(input),
          previousStatus: existing.status,
          ...(scriptWithdrawn ? { scriptApprovalWithdrawn: true } : {}),
          ...(options.metadata ?? {}),
        },
        ...(diff ?? {}),
        ipAddress: meta.ip,
        requestId: meta.requestId,
      },
      tx,
    );
    return tc;
  });
  return toDto(updated);
}

export async function deleteTestCase(auth: AuthContext, projectId: string, id: string, meta: Meta) {
  await requireProjectAccess(auth, projectId, "testcases:write");
  const existing = await findTestCase(projectId, id);
  await db.testCase.update({
    where: { id: existing.id },
    data: { deletedAt: new Date(), updatedById: auth.user.id },
  });
  await audit({
    action: "testcase.delete",
    entityType: "test_case",
    entityId: existing.id,
    projectId,
    actorId: auth.user.id,
    metadata: { key: existing.key },
    before: { title: existing.title, status: existing.status },
    after: {},
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });
}

const isApprovedLike = (s: TestCaseStatus) => (APPROVED_LIKE as readonly string[]).includes(s);

/**
 * Review decisions on a set of cases (all must belong to the project):
 * - APPROVE: Draft → Approved. Cases already approved (or scripted / run) are left as they are.
 *   A Rejected case must be reopened first.
 * - REJECT: any case → Rejected, with a reason. It leaves the cycle until reopened.
 * - REOPEN: any case → Draft.
 */
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
    select: { id: true, key: true, status: true },
  });
  // All-or-nothing: an ID from another project makes the whole request fail.
  if (rows.length !== ids.length) throw notFound("Test case");

  let targets = rows;
  if (input.decision === "APPROVE") {
    const rejected = rows.filter((r) => r.status === "REJECTED");
    if (rejected.length > 0) {
      const many = rejected.length > 1;
      throw conflict(
        `${rejected.map((r) => r.key).join(", ")} ${many ? "were" : "was"} rejected. Reopen ${many ? "them" : "it"} as Draft before approving.`,
      );
    }
    targets = rows.filter((r) => !isApprovedLike(r.status));
  } else if (input.decision === "REJECT") {
    targets = rows.filter((r) => r.status !== "REJECTED");
  } else {
    targets = rows.filter((r) => r.status !== "DRAFT");
  }
  if (targets.length === 0) return { updated: 0 };

  const now = new Date();
  const status: TestCaseStatus =
    input.decision === "APPROVE" ? "APPROVED" : input.decision === "REJECT" ? "REJECTED" : "DRAFT";
  const data: Prisma.TestCaseUncheckedUpdateManyInput =
    status === "APPROVED"
      ? { status, reviewedById: auth.user.id, reviewedAt: now, rejectionReason: null }
      : status === "REJECTED"
        ? {
            status,
            reviewedById: auth.user.id,
            reviewedAt: now,
            rejectionReason: input.reason ?? "",
          }
        : { status, reviewedById: null, reviewedAt: null, rejectionReason: null };
  const action =
    status === "APPROVED"
      ? "testcase.approve"
      : status === "REJECTED"
        ? "testcase.reject"
        : "testcase.reopen";

  await db.$transaction(async (tx) => {
    await tx.testCase.updateMany({
      where: { id: { in: targets.map((t) => t.id) }, projectId },
      data: { ...data, updatedById: auth.user.id },
    });
    for (const r of targets) {
      await audit(
        {
          action,
          entityType: "test_case",
          entityId: r.id,
          projectId,
          actorId: auth.user.id,
          metadata: { key: r.key, ...(input.reason ? { reason: input.reason } : {}) },
          before: { status: r.status },
          after: { status },
          ipAddress: meta.ip,
          requestId: meta.requestId,
        },
        tx,
      );
    }
  });
  return { updated: targets.length };
}

// ── Export (FR-4.6) ─────────────────────────────────────────────────────────

const EXPORT_COLUMNS = [
  "ID",
  "Scenario",
  "Title",
  "Status",
  "Type",
  "Priority",
  "Preconditions",
  "Steps",
  "Test data",
  "Expected result",
  "Requirements",
  "Sources",
  "Automatable",
  "Automation note",
  "Tags",
  "Reviewed by",
  "Rejection reason",
] as const;

const WIDE_COLUMNS = new Set(["Title", "Preconditions", "Steps", "Expected result", "Sources"]);

function exportRow(t: TestCaseDto): string[] {
  return [
    t.key,
    t.scenario ? `${t.scenario.key} ${t.scenario.title}` : "",
    t.title,
    TEST_CASE_STATUS_LABELS[t.status],
    TEST_CASE_TYPE_LABELS[t.type],
    t.priority,
    t.preconditions ?? "",
    t.steps
      .map((s, i) => `${i + 1}. ${s.action}${s.expected ? ` → ${s.expected}` : ""}`)
      .join("\n"),
    t.testData.map((d) => `${d.name}: ${d.value}`).join("\n"),
    t.expectedResult,
    t.requirements.map((r) => r.key).join(", "),
    t.sources
      .map((s) => `${s.requirementKey}: ${s.document}${s.section ? `, ${s.section}` : ""}`)
      .join("\n"),
    t.automatable ? "Yes" : "No",
    t.automatableReason ?? "",
    t.tags.join(", "),
    t.reviewedBy ?? "",
    t.rejectionReason ?? "",
  ].map((v) => safeCell(v));
}

function toCsv(rows: string[][]): Buffer {
  const cell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const body = rows.map((r) => r.map(cell).join(",")).join("\r\n");
  // BOM so Excel opens UTF-8 correctly.
  return Buffer.from(`﻿${body}\r\n`, "utf8");
}

function toXlsx(rows: string[][]): Promise<Buffer> {
  const [head, ...rest] = rows;
  const data: XlsxRow[] = [
    (head ?? []).map((value) => ({
      value,
      fontWeight: "bold" as const,
      backgroundColor: "#EAEFFE",
    })),
    ...rest.map((r) => r.map((value) => ({ value, type: String, wrap: true }))),
  ];
  return writeXlsxFile([
    {
      sheet: "Test cases",
      data,
      columns: EXPORT_COLUMNS.map((c) => ({ width: WIDE_COLUMNS.has(c) ? 45 : 16 })),
      stickyRowsCount: 1,
    },
  ]).toBuffer();
}

/** Every field of the (filtered) cases, as CSV or Excel. Values are formula-safe. */
export async function exportTestCases(
  auth: AuthContext,
  projectId: string,
  format: "csv" | "xlsx",
  filters: TestCaseFilters,
  meta: Meta,
): Promise<{ bytes: Buffer; mimeType: string; fileName: string }> {
  const project = await requireProjectAccess(auth, projectId, "exports:create", {
    allowArchived: true,
  });
  const cases = await listTestCases(auth, projectId, filters);
  const rows = [[...EXPORT_COLUMNS], ...cases.map(exportRow)];
  const bytes = format === "csv" ? toCsv(rows) : await toXlsx(rows);
  await audit({
    action: "testcase.export",
    entityType: "project",
    entityId: projectId,
    projectId,
    actorId: auth.user.id,
    metadata: { format, count: cases.length },
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });
  const base = project.name.replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-|-$/g, "") || "project";
  return {
    bytes,
    mimeType:
      format === "csv"
        ? "text/csv; charset=utf-8"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    fileName: `${base}-test-cases.${format}`,
  };
}
