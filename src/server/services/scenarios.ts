import type { z } from "zod";
import type { scenarioCreateSchema, scenarioUpdateSchema } from "@/lib/validation";
import type { AuthContext } from "@/server/auth/session";
import { isValidId, requireProjectAccess } from "@/server/authz/guards";
import { db } from "@/server/db";
import { conflict, notFound } from "@/server/errors";
import { audit, changes } from "@/server/services/audit";
import { allocateKeys } from "@/server/services/keys";

interface Meta {
  ip: string;
  requestId: string;
}

/** FRD data model: a Scenario is a user flow to verify; test cases belong to one. */
export async function listScenarios(auth: AuthContext, projectId: string) {
  await requireProjectAccess(auth, projectId, "projects:read");
  const rows = await db.scenario.findMany({
    where: { projectId, deletedAt: null },
    orderBy: { key: "asc" },
    include: {
      testCases: { where: { deletedAt: null }, select: { status: true } },
    },
  });
  return rows.map(({ testCases, ...s }) => ({
    id: s.id,
    key: s.key,
    title: s.title,
    description: s.description,
    flowSteps: Array.isArray(s.flowSteps) ? s.flowSteps.map(String) : [],
    origin: s.origin,
    testCaseCount: testCases.filter((t) => t.status !== "REJECTED").length,
    draftCount: testCases.filter((t) => t.status === "DRAFT").length,
  }));
}

export async function createScenario(
  auth: AuthContext,
  projectId: string,
  input: z.infer<typeof scenarioCreateSchema>,
  meta: Meta,
) {
  await requireProjectAccess(auth, projectId, "testcases:write");
  return db.$transaction(async (tx) => {
    const [key] = await allocateKeys(tx, projectId, "SC", 1);
    const scenario = await tx.scenario.create({
      data: {
        projectId,
        key: key ?? "",
        title: input.title,
        description: input.description ?? null,
        flowSteps: input.flowSteps ?? [],
        origin: "MANUAL",
      },
    });
    await audit(
      {
        action: "scenario.create",
        entityType: "scenario",
        entityId: scenario.id,
        projectId,
        actorId: auth.user.id,
        metadata: { key: scenario.key },
        after: { title: scenario.title },
        ipAddress: meta.ip,
        requestId: meta.requestId,
      },
      tx,
    );
    return scenario;
  });
}

async function findScenario(projectId: string, id: string) {
  if (!isValidId(id)) throw notFound("Scenario");
  const s = await db.scenario.findFirst({ where: { id, projectId, deletedAt: null } });
  if (!s) throw notFound("Scenario");
  return s;
}

export async function updateScenario(
  auth: AuthContext,
  projectId: string,
  id: string,
  input: z.infer<typeof scenarioUpdateSchema>,
  meta: Meta,
) {
  await requireProjectAccess(auth, projectId, "testcases:write");
  const existing = await findScenario(projectId, id);
  const updated = await db.scenario.update({
    where: { id: existing.id },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.flowSteps !== undefined ? { flowSteps: input.flowSteps } : {}),
    },
  });
  const diff = changes(existing, updated, ["title", "description", "flowSteps"]);
  await audit({
    action: "scenario.update",
    entityType: "scenario",
    entityId: existing.id,
    projectId,
    actorId: auth.user.id,
    metadata: { key: existing.key },
    ...(diff ?? {}),
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });
  return updated;
}

/** Only an empty scenario can be removed: test cases must always belong to one. */
export async function deleteScenario(auth: AuthContext, projectId: string, id: string, meta: Meta) {
  await requireProjectAccess(auth, projectId, "testcases:write");
  const existing = await findScenario(projectId, id);
  const inUse = await db.testCase.count({ where: { scenarioId: existing.id, deletedAt: null } });
  if (inUse > 0) {
    throw conflict("This scenario still has test cases. Move or delete them first.");
  }
  await db.scenario.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });
  await audit({
    action: "scenario.update",
    entityType: "scenario",
    entityId: existing.id,
    projectId,
    actorId: auth.user.id,
    metadata: { key: existing.key, deleted: true },
    before: { title: existing.title },
    after: {},
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });
}
