import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { newBoundary, normalizeForCompare, untrusted } from "@/server/ai/prompt";
import { runStructured } from "@/server/ai/run";
import {
  generationOutputSchema,
  generationSystemPrompt,
  type GenerationOutput,
} from "@/server/ai/tasks/generation";
import { db } from "@/server/db";
import { toJobFailure } from "@/server/jobs/ai-errors";
import { JobFailure, type JobHandler } from "@/server/jobs/runner";
import { audit } from "@/server/services/audit";
import { allocateKeys } from "@/server/services/keys";

const REQUIREMENTS_PER_CALL = 8;
const MAX_REQUIREMENTS = 300;

const payloadSchema = z.object({
  requirementIds: z.array(z.string()).max(MAX_REQUIREMENTS).optional(),
});

type GeneratedCase = GenerationOutput["testCases"][number];

/**
 * Generates DRAFT test cases for the chosen requirements (default: those without any test case).
 * Links to unknown requirement keys are dropped; nothing is saved unless every call succeeds.
 */
export const generateTestCasesHandler: JobHandler = async ({ job, signal }) => {
  const projectId = job.projectId;
  const payload = payloadSchema.safeParse(job.payload ?? {});
  if (!payload.success) throw new JobFailure("This job has invalid settings.", false);
  const ids = payload.data.requirementIds;

  const requirements = await db.requirement.findMany({
    where: {
      projectId,
      deletedAt: null,
      ...(ids && ids.length > 0
        ? { id: { in: ids } }
        : { testCases: { none: { testCase: { deletedAt: null } } } }),
    },
    orderBy: { key: "asc" },
    take: MAX_REQUIREMENTS,
  });
  if (requirements.length === 0) {
    throw new JobFailure(
      ids?.length
        ? "None of the selected requirements exist anymore."
        : "Every requirement already has test cases. Select specific requirements to generate more.",
      false,
    );
  }

  const [flows, answered, existingCases] = await Promise.all([
    db.userFlow.findMany({ where: { projectId, deletedAt: null }, take: 20 }),
    db.openQuestion.findMany({ where: { projectId, status: "ANSWERED" }, take: 100 }),
    db.testCase.findMany({
      where: { projectId, deletedAt: null },
      select: { title: true, requirements: { select: { requirement: { select: { key: true } } } } },
    }),
  ]);
  const keyToId = new Map(requirements.map((r) => [r.key, r.id]));
  const seenTitles = new Set(existingCases.map((c) => normalizeForCompare(c.title)));

  const flowsText = flows
    .map((f) => `${f.name}: ${(Array.isArray(f.steps) ? f.steps : []).join(" → ")}`)
    .join("\n");
  const clarificationsText = answered
    .map((q) => `Q: ${q.question}\nA: ${q.answer ?? ""}`)
    .join("\n\n");

  const generated: GeneratedCase[] = [];
  const batches = Math.ceil(requirements.length / REQUIREMENTS_PER_CALL);
  for (let b = 0; b < batches; b++) {
    if (signal.aborted) throw new JobFailure("Generation was stopped.", false);
    const batch = requirements.slice(b * REQUIREMENTS_PER_CALL, (b + 1) * REQUIREMENTS_PER_CALL);
    const batchKeys = new Set(batch.map((r) => r.key));
    const existingForBatch = existingCases
      .filter((c) => c.requirements.some((l) => batchKeys.has(l.requirement.key)))
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
      clarificationsText && untrusted(boundary, "answered clarifications", clarificationsText),
      existingForBatch &&
        untrusted(boundary, "existing test cases (do not duplicate)", existingForBatch),
    ].filter(Boolean);

    let output: GenerationOutput;
    try {
      output = await runStructured(
        { projectId, jobId: job.id },
        {
          purpose: "GENERATE_TEST_CASES",
          system: generationSystemPrompt(boundary),
          content: [
            {
              type: "text",
              text: `Write test cases for these requirements.\n\n${blocks.join("\n\n")}`,
            },
          ],
          schema: generationOutputSchema,
          schemaName: "test_case_generation",
          maxOutputTokens: 16_000,
          signal,
        },
      );
    } catch (err) {
      throw toJobFailure(err);
    }

    for (const tc of output.testCases) {
      // Only keep links to requirements in this batch: the model may not invent or borrow keys.
      const keys = [...new Set(tc.requirementKeys.filter((k) => batchKeys.has(k)))];
      const norm = normalizeForCompare(tc.title);
      if (keys.length === 0 || seenTitles.has(norm)) continue;
      seenTitles.add(norm);
      generated.push({ ...tc, requirementKeys: keys });
    }
    await db.job.update({
      where: { id: job.id },
      data: { progress: Math.round(((b + 1) / batches) * 90) },
    });
  }

  await db.$transaction(async (tx) => {
    const keys = await allocateKeys(tx, projectId, "TC", generated.length);
    for (const [i, tc] of generated.entries()) {
      await tx.testCase.create({
        data: {
          projectId,
          key: keys[i] ?? "",
          title: tc.title,
          preconditions: tc.preconditions,
          steps: tc.steps as Prisma.InputJsonValue,
          testData: Object.fromEntries(tc.testData.map((d) => [d.name, d.value])),
          expectedResult: tc.expectedResult,
          type: tc.type,
          priority: tc.priority,
          automatable: tc.automatable,
          automatableReason: tc.automatableReason || null,
          origin: "AI",
          status: "DRAFT",
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
        },
      },
      tx,
    );
  });

  return { requirements: requirements.length, testCasesAdded: generated.length };
};
