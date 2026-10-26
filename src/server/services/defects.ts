import type { z } from "zod";
import type { DefectStatus, Prisma } from "@/generated/prisma/client";
import type { defectCreateSchema, defectUpdateSchema } from "@/lib/validation";
import type { AuthContext } from "@/server/auth/session";
import { isValidId, requireProjectAccess } from "@/server/authz/guards";
import { db } from "@/server/db";
import { badRequest, notFound } from "@/server/errors";
import { audit, changes } from "@/server/services/audit";
import { allocateKeys } from "@/server/services/keys";

interface Meta {
  ip: string;
  requestId: string;
}

const DEFECT_SELECT = {
  id: true,
  key: true,
  title: true,
  description: true,
  severity: true,
  status: true,
  externalUrl: true,
  resolvedAt: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { name: true } },
  testCase: { select: { id: true, key: true, title: true } },
  runTest: { select: { id: true, runId: true } },
} satisfies Prisma.DefectSelect;

const AUDITED = ["title", "description", "severity", "status", "externalUrl"] as const;

export async function listDefects(auth: AuthContext, projectId: string, status?: DefectStatus) {
  await requireProjectAccess(auth, projectId, "projects:read", { allowArchived: true });
  return db.defect.findMany({
    where: { projectId, ...(status ? { status } : {}) },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 500,
    select: DEFECT_SELECT,
  });
}

/**
 * FRD step 7: "A failed case can be logged as a defect (manually in v1)". From a report the
 * defect is linked to the failed result; its test case comes from that result.
 */
export async function createDefect(
  auth: AuthContext,
  projectId: string,
  input: z.infer<typeof defectCreateSchema>,
  meta: Meta,
) {
  await requireProjectAccess(auth, projectId, "defects:write");
  let testCaseId = input.testCaseId ?? null;
  let runTestId: string | null = null;
  if (input.runTestId) {
    const rt = await db.runTest.findFirst({
      where: { id: input.runTestId, run: { projectId } },
      select: { id: true, testCaseId: true },
    });
    if (!rt) throw notFound("Test result");
    if (testCaseId && testCaseId !== rt.testCaseId) {
      throw badRequest("That result belongs to a different test case.");
    }
    runTestId = rt.id;
    testCaseId = rt.testCaseId;
  } else if (testCaseId) {
    const found = await db.testCase.count({
      where: { id: testCaseId, projectId, deletedAt: null },
    });
    if (!found) throw notFound("Test case");
  }
  return db.$transaction(async (tx) => {
    const [key] = await allocateKeys(tx, projectId, "BUG", 1);
    const d = await tx.defect.create({
      data: {
        projectId,
        key: key!,
        title: input.title,
        description: input.description,
        severity: input.severity,
        externalUrl: input.externalUrl ?? null,
        testCaseId,
        runTestId,
        createdById: auth.user.id,
      },
      select: DEFECT_SELECT,
    });
    await audit(
      {
        action: "defect.create",
        entityType: "defect",
        entityId: d.id,
        projectId,
        actorId: auth.user.id,
        metadata: { key: d.key, severity: d.severity, testCaseId, runTestId },
        ipAddress: meta.ip,
        requestId: meta.requestId,
      },
      tx,
    );
    return d;
  });
}

export async function updateDefect(
  auth: AuthContext,
  projectId: string,
  defectId: string,
  input: z.infer<typeof defectUpdateSchema>,
  meta: Meta,
) {
  await requireProjectAccess(auth, projectId, "defects:write");
  if (!isValidId(defectId)) throw notFound("Defect");
  const before = await db.defect.findFirst({ where: { id: defectId, projectId } });
  if (!before) throw notFound("Defect");
  const resolvedAt =
    input.status === undefined || input.status === before.status
      ? undefined
      : input.status === "RESOLVED"
        ? new Date()
        : null;
  return db.$transaction(async (tx) => {
    const after = await tx.defect.update({
      where: { id: before.id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.severity !== undefined ? { severity: input.severity } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.externalUrl !== undefined ? { externalUrl: input.externalUrl } : {}),
        ...(resolvedAt !== undefined ? { resolvedAt } : {}),
      },
    });
    const diff = changes(before, after, AUDITED);
    if (diff) {
      await audit(
        {
          action: "defect.update",
          entityType: "defect",
          entityId: after.id,
          projectId,
          actorId: auth.user.id,
          metadata: { key: after.key },
          ...diff,
          ipAddress: meta.ip,
          requestId: meta.requestId,
        },
        tx,
      );
    }
    return tx.defect.findUniqueOrThrow({ where: { id: after.id }, select: DEFECT_SELECT });
  });
}
