import { z } from "zod";
import { newBoundary, untrusted } from "@/server/ai/prompt";
import { REWRITE_CASE_PROMPT } from "@/server/ai/prompts/library";
import { promptRef, systemPrompt } from "@/server/ai/prompts/template";
import { runStructured } from "@/server/ai/run";
import { rewriteOutputSchema } from "@/server/ai/tasks/generation";
import { db } from "@/server/db";
import { toJobFailure } from "@/server/jobs/ai-errors";
import { JobFailure, type JobHandler } from "@/server/jobs/runner";

const payloadSchema = z.object({
  testCaseId: z.string().min(1),
  instruction: z.string().min(1).max(1000),
});

/**
 * "Ask the assistant to rewrite this case": produces a PROPOSAL only (kept in the job result).
 * Nothing changes until the tester accepts it.
 */
export const rewriteTestCaseHandler: JobHandler = async ({ job, signal }) => {
  const payload = payloadSchema.safeParse(job.payload);
  if (!payload.success) throw new JobFailure("This job has invalid settings.", false);
  const tc = await db.testCase.findFirst({
    where: { id: payload.data.testCaseId, projectId: job.projectId, deletedAt: null },
    include: {
      scenario: { select: { title: true } },
      requirements: {
        where: { requirement: { deletedAt: null } },
        select: { requirement: { select: { key: true, text: true } } },
      },
    },
  });
  if (!tc) throw new JobFailure("This test case no longer exists.", false);

  const current = {
    title: tc.title,
    scenario: tc.scenario?.title ?? null,
    preconditions: tc.preconditions,
    steps: tc.steps,
    testData: tc.testData,
    expectedResult: tc.expectedResult,
    type: tc.type,
    priority: tc.priority,
    requirementKeys: tc.requirements.map((r) => r.requirement.key),
    automatable: tc.automatable,
    automatableReason: tc.automatableReason,
    tags: tc.tags,
  };
  const boundary = newBoundary();
  let output;
  try {
    output = await runStructured(
      { projectId: job.projectId, jobId: job.id },
      {
        purpose: "REWRITE_TEST_CASE",
        promptVersion: promptRef(REWRITE_CASE_PROMPT),
        system: systemPrompt(REWRITE_CASE_PROMPT, boundary),
        content: [
          {
            type: "text",
            text: [
              "Rewrite this test case.",
              untrusted(boundary, "current test case", JSON.stringify(current, null, 2)),
              untrusted(
                boundary,
                "linked requirements",
                tc.requirements.map((r) => `${r.requirement.key} ${r.requirement.text}`).join("\n"),
              ),
              untrusted(boundary, "tester instruction", payload.data.instruction),
            ].join("\n\n"),
          },
        ],
        schema: rewriteOutputSchema,
        schemaName: "test_case_rewrite",
        maxOutputTokens: 6_000,
        signal,
      },
    );
  } catch (err) {
    throw toJobFailure(err);
  }
  return { testCaseId: tc.id, proposal: output.testCase };
};
