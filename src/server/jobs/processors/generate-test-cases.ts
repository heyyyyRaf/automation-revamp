import { z } from "zod";
import type { Prisma, Requirement } from "@/generated/prisma/client";
import { runParts } from "@/server/ai/pool";
import { newBoundary, normalizeForCompare, untrusted } from "@/server/ai/prompt";
import { GENERATION_PROMPT } from "@/server/ai/prompts/library";
import { promptRef, systemPrompt } from "@/server/ai/prompts/template";
import { runStructured } from "@/server/ai/run";
import { generationOutputSchema, type GenerationOutput } from "@/server/ai/tasks/generation";
import { db } from "@/server/db";
import { toJobFailure } from "@/server/jobs/ai-errors";
import { JobFailure, type JobHandler } from "@/server/jobs/runner";
import { audit } from "@/server/services/audit";
import { allocateKeys } from "@/server/services/keys";

const REQUIREMENTS_PER_CALL = 8;
const MAX_REQUIREMENTS = 300;
const CONCURRENCY = 4;
const BATCH_RETRIES = 2;
/** Where a case goes when the model names no usable scenario. */
const FALLBACK_SCENARIO = "Other checks";

const payloadSchema = z.object({
  requirementIds: z.array(z.string()).max(MAX_REQUIREMENTS).optional(),
  /** FR-4.5: write replacements for these rejected cases, using the rejection reasons. */
  regenerateIds: z.array(z.string()).max(200).optional(),
});

type OutCase = GenerationOutput["testCases"][number];

interface PendingCase extends Omit<OutCase, "scenarioRef"> {
  /** Normalised scenario title, resolved to an id when saving. */
  scenarioKey: string;
}

interface PendingScenario {
  title: string;
  description: string;
  flowSteps: string[];
}

/**
 * Generates DRAFT test cases, grouped into scenarios, for the chosen requirements (default:
 * those without any test case). Batches run in parallel and are retried on their own; what
 * succeeded is saved and requirements left without a case are reported (FR-4.1).
 */
export const generateTestCasesHandler: JobHandler = async ({ job, signal }) => {
  const projectId = job.projectId;
  const payload = payloadSchema.safeParse(job.payload ?? {});
  if (!payload.success) throw new JobFailure("This job has invalid settings.", false);
  const { requirementIds: ids, regenerateIds } = payload.data;

  const rejected = regenerateIds?.length
    ? await db.testCase.findMany({
        where: { id: { in: regenerateIds }, projectId, deletedAt: null, status: "REJECTED" },
        include: { requirements: { select: { requirementId: true } } },
      })
    : [];
  if (regenerateIds?.length && rejected.length === 0) {
    throw new JobFailure("The rejected test cases to replace no longer exist.", false);
  }
  const targetIds = rejected.length
    ? [...new Set(rejected.flatMap((t) => t.requirements.map((r) => r.requirementId)))]
    : ids;

  const requirements = await db.requirement.findMany({
    where: {
      projectId,
      deletedAt: null,
      ...(targetIds && targetIds.length > 0
        ? { id: { in: targetIds } }
        : {
            testCases: {
              none: { testCase: { deletedAt: null, status: { not: "REJECTED" } } },
            },
          }),
    },
    orderBy: { key: "asc" },
    take: MAX_REQUIREMENTS,
  });
  if (requirements.length === 0) {
    throw new JobFailure(
      targetIds?.length
        ? "None of the selected requirements exist anymore."
        : "Every requirement already has test cases. Select specific requirements to generate more.",
      false,
    );
  }

  const [flows, answered, existingCases, existingScenarios] = await Promise.all([
    db.userFlow.findMany({ where: { projectId, deletedAt: null }, take: 20 }),
    db.openQuestion.findMany({ where: { projectId, status: "ANSWERED" }, take: 100 }),
    db.testCase.findMany({
      where: { projectId, deletedAt: null },
      select: {
        title: true,
        status: true,
        requirements: { select: { requirement: { select: { key: true } } } },
      },
    }),
    db.scenario.findMany({ where: { projectId, deletedAt: null }, orderBy: { key: "asc" } }),
  ]);
  const keyToId = new Map(requirements.map((r) => [r.key, r.id]));
  const seenTitles = new Set(
    existingCases.filter((c) => c.status !== "REJECTED").map((c) => normalizeForCompare(c.title)),
  );

  const flowsText = flows
    .map((f) => `${f.name}: ${(Array.isArray(f.steps) ? f.steps : []).join(" → ")}`)
    .join("\n");
  const clarificationsText = answered
    .map((q) => `Q: ${q.question}\nA: ${q.answer ?? ""}`)
    .join("\n\n");
  const scenariosText = existingScenarios.map((s) => `- ${s.title}`).join("\n");
  const rejectedText = rejected
    .map((t) => `- ${t.title}\n  Rejected because: ${t.rejectionReason ?? "no reason given"}`)
    .join("\n");

  const batches: Requirement[][] = [];
  for (let i = 0; i < requirements.length; i += REQUIREMENTS_PER_CALL) {
    batches.push(requirements.slice(i, i + REQUIREMENTS_PER_CALL));
  }

  const results = await runParts(
    batches,
    (batch) => {
      const batchKeys = new Set(batch.map((r) => r.key));
      const existingForBatch = existingCases
        .filter(
          (c) =>
            c.status !== "REJECTED" && c.requirements.some((l) => batchKeys.has(l.requirement.key)),
        )
        .map((c) => `- ${c.title}`)
        .join("\n");
      const boundary = newBoundary();
      const blocks = [
        untrusted(
          boundary,
          "requirements",
          batch.map((r) => `${r.key} [${r.type}] ${r.text}`).join("\n"),
        ),
        flowsText && untrusted(boundary, "user flows", flowsText),
        scenariosText && untrusted(boundary, "existing scenarios", scenariosText),
        clarificationsText && untrusted(boundary, "answered clarifications", clarificationsText),
        existingForBatch &&
          untrusted(boundary, "existing test cases (do not duplicate)", existingForBatch),
        rejectedText &&
          untrusted(
            boundary,
            "rejected test cases (write better replacements that fix these problems)",
            rejectedText,
          ),
      ].filter(Boolean);
      return runStructured(
        { projectId, jobId: job.id },
        {
          purpose: "GENERATE_TEST_CASES",
          promptVersion: promptRef(GENERATION_PROMPT),
          system: systemPrompt(GENERATION_PROMPT, boundary),
          content: [
            {
              type: "text",
              text: `Write test scenarios and test cases for these requirements.\n\n${blocks.join("\n\n")}`,
            },
          ],
          schema: generationOutputSchema,
          schemaName: "test_case_generation",
          maxOutputTokens: 16_000,
          signal,
        },
      );
    },
    {
      concurrency: CONCURRENCY,
      retries: BATCH_RETRIES,
      signal,
      onDone: async (done, total) => {
        await db.job.update({
          where: { id: job.id },
          data: {
            progress: Math.round((done / total) * 90),
            result: { note: `Writing test cases: part ${done} of ${total} done` },
          },
        });
      },
    },
  ).catch((err: unknown) => {
    throw toJobFailure(err);
  });
  if (signal.aborted) throw new JobFailure("Generation was stopped.", false);

  // Resolve scenarios by normalised title: existing ones are reused, new ones created once.
  const scenarioByKey = new Map<string, { id?: string; pending?: PendingScenario }>();
  for (const s of existingScenarios) scenarioByKey.set(normalizeForCompare(s.title), { id: s.id });
  const fallbackKey = normalizeForCompare(FALLBACK_SCENARIO);

  const generated: PendingCase[] = [];
  const failedKeys = new Set<string>();
  let batchErrors = 0;
  let firstError: string | undefined;
  results.forEach((r, b) => {
    const batch = batches[b] ?? [];
    if (!r.ok) {
      batchErrors++;
      firstError ??= r.error;
      for (const req of batch) failedKeys.add(req.key);
      return;
    }
    const batchKeys = new Set(batch.map((x) => x.key));
    const localRefs = new Map<string, string>();
    for (const s of r.value.scenarios) {
      const key = normalizeForCompare(s.title);
      if (!key) continue;
      localRefs.set(s.ref, key);
      if (!scenarioByKey.has(key)) {
        scenarioByKey.set(key, {
          pending: { title: s.title, description: s.description, flowSteps: s.flowSteps },
        });
      }
    }
    for (const tc of r.value.testCases) {
      // Only keep links to requirements in this batch: the model may not invent or borrow keys.
      const keys = [...new Set(tc.requirementKeys.filter((k) => batchKeys.has(k)))];
      const norm = normalizeForCompare(tc.title);
      if (keys.length === 0 || seenTitles.has(norm)) continue;
      seenTitles.add(norm);

      const { scenarioRef, ...rest } = tc;
      let scenarioKey = scenarioRef.startsWith("EXISTING:")
        ? normalizeForCompare(scenarioRef.slice("EXISTING:".length))
        : (localRefs.get(scenarioRef) ?? "");
      if (!scenarioKey || !scenarioByKey.has(scenarioKey)) {
        scenarioKey = fallbackKey;
        if (!scenarioByKey.has(fallbackKey)) {
          scenarioByKey.set(fallbackKey, {
            pending: {
              title: FALLBACK_SCENARIO,
              description: "Checks that don't belong to a specific user flow.",
              flowSteps: [],
            },
          });
        }
      }
      generated.push({ ...rest, requirementKeys: keys, scenarioKey });
    }
  });

  if (batchErrors === batches.length) {
    // Every batch already had its own retries; retrying the whole job would not help.
    throw new JobFailure(firstError ?? "Test case generation failed.", false);
  }

  const covered = new Set(generated.flatMap((c) => c.requirementKeys));
  const notCovered = requirements
    .filter((r) => !covered.has(r.key))
    .map((r) => ({
      key: r.key,
      reason: failedKeys.has(r.key)
        ? "The AI call for this requirement failed. Try generating again."
        : "The AI wrote no new test case for it (it may already be covered).",
    }));

  const usedKeys = new Set(generated.map((c) => c.scenarioKey));
  const newScenarios: [string, PendingScenario][] = [];
  for (const [key, s] of scenarioByKey) {
    if (s.pending && usedKeys.has(key)) newScenarios.push([key, s.pending]);
  }

  await db.$transaction(async (tx) => {
    const scKeys = await allocateKeys(tx, projectId, "SC", newScenarios.length);
    for (const [i, [key, s]] of newScenarios.entries()) {
      const created = await tx.scenario.create({
        data: {
          projectId,
          key: scKeys[i] ?? "",
          title: s.title,
          description: s.description || null,
          flowSteps: s.flowSteps,
          origin: "AI",
        },
        select: { id: true },
      });
      scenarioByKey.set(key, { id: created.id });
    }

    const tcKeys = await allocateKeys(tx, projectId, "TC", generated.length);
    for (const [i, tc] of generated.entries()) {
      await tx.testCase.create({
        data: {
          projectId,
          key: tcKeys[i] ?? "",
          title: tc.title,
          scenarioId: scenarioByKey.get(tc.scenarioKey)?.id ?? null,
          preconditions: tc.preconditions,
          steps: tc.steps as Prisma.InputJsonValue,
          testData: Object.fromEntries(tc.testData.map((d) => [d.name, d.value])),
          expectedResult: tc.expectedResult,
          type: tc.type,
          priority: tc.priority,
          automatable: tc.automatable,
          automatableReason: tc.automatableReason,
          tags: [...new Set(tc.tags.map((t) => t.toLowerCase()))],
          origin: "AI",
          status: "DRAFT",
          createdById: job.createdById,
          requirements: {
            create: tc.requirementKeys.map((k) => ({ requirementId: keyToId.get(k) ?? "" })),
          },
        },
      });
    }
    await audit(
      {
        action: "ai.generate_test_cases",
        entityType: "project",
        entityId: projectId,
        projectId,
        actorId: job.createdById,
        metadata: {
          jobId: job.id,
          requirements: requirements.length,
          testCasesAdded: generated.length,
          scenariosAdded: newScenarios.length,
          notCovered: notCovered.length,
          ...(rejected.length ? { replacing: rejected.map((t) => t.key) } : {}),
        },
      },
      tx,
    );
  });

  return {
    requirements: requirements.length,
    testCasesAdded: generated.length,
    scenariosAdded: newScenarios.length,
    partial: batchErrors > 0,
    notCovered,
  };
};
