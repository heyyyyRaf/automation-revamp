import { z } from "zod";
import { PRIORITIES, TEST_CASE_TYPES } from "@/lib/domain";

/** FR-4.3: every field is required — the schema rejects a case with any field missing. */
export const generatedCaseSchema = z.object({
  title: z.string().trim().min(5).max(200),
  preconditions: z.string().trim().min(1).max(2000),
  steps: z
    .array(
      z.object({
        action: z.string().trim().min(1).max(1000),
        expected: z.string().max(1000).nullable(),
      }),
    )
    .min(1)
    .max(30),
  testData: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(100),
        value: z.string().trim().min(1).max(500),
      }),
    )
    .min(1)
    .max(30),
  expectedResult: z.string().trim().min(1).max(2000),
  type: z.enum(TEST_CASE_TYPES),
  priority: z.enum(PRIORITIES),
  requirementKeys: z.array(z.string().max(20)).min(1).max(20),
  automatable: z.boolean(),
  automatableReason: z.string().trim().min(1).max(500),
  tags: z.array(z.string().trim().min(1).max(30)).max(3),
});

export type GeneratedCase = z.infer<typeof generatedCaseSchema>;

export const generationOutputSchema = z.object({
  scenarios: z
    .array(
      z.object({
        ref: z.string().trim().min(1).max(12),
        title: z.string().trim().min(3).max(200),
        description: z.string().max(2000),
        flowSteps: z.array(z.string().trim().min(1).max(500)).max(40),
      }),
    )
    .max(40),
  testCases: z
    .array(generatedCaseSchema.extend({ scenarioRef: z.string().trim().min(1).max(220) }))
    .max(80),
});

export type GenerationOutput = z.infer<typeof generationOutputSchema>;

/** FR-4.5 / design "Ask the assistant to rewrite this case": one case back. */
export const rewriteOutputSchema = z.object({ testCase: generatedCaseSchema });
export type RewriteOutput = z.infer<typeof rewriteOutputSchema>;
