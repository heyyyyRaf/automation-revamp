import { z } from "zod";
import { dataGuard } from "@/server/ai/prompt";

export const TEST_CASE_TYPES = ["POSITIVE", "NEGATIVE", "BOUNDARY"] as const;
export const PRIORITIES = ["HIGH", "MEDIUM", "LOW"] as const;

export const generationOutputSchema = z.object({
  testCases: z
    .array(
      z.object({
        title: z.string().trim().min(5).max(200),
        preconditions: z.string().max(2000).nullable(),
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
          .array(z.object({ name: z.string().trim().min(1).max(100), value: z.string().max(500) }))
          .max(30),
        expectedResult: z.string().trim().min(1).max(2000),
        type: z.enum(TEST_CASE_TYPES),
        priority: z.enum(PRIORITIES),
        requirementKeys: z.array(z.string().max(20)).min(1).max(20),
        automatable: z.boolean(),
        automatableReason: z.string().max(500),
      }),
    )
    .max(80),
});

export type GenerationOutput = z.infer<typeof generationOutputSchema>;

export function generationSystemPrompt(boundary: string): string {
  return [
    "You are a senior QA engineer. Write manual test cases for the requirements provided.",
    "",
    "For each requirement write, where they make sense:",
    "- POSITIVE cases (expected behaviour with valid input),",
    "- NEGATIVE cases (invalid input, errors, missing permissions),",
    "- BOUNDARY cases (limits, empty values, maximum lengths, edge dates).",
    "Rules:",
    "- requirementKeys: the REQ-... keys each case verifies. Only use keys that appear in the input.",
    "- steps: concrete actions a tester can follow, with the expected outcome where useful.",
    "- testData: name/value pairs. For accounts and secrets use placeholders such as {{STANDARD_USER}}",
    "  or {{ADMIN_PASSWORD}} — never invent real-looking credentials.",
    "- automatable: true only if the case can be automated in a web browser with Playwright;",
    "  explain why in automatableReason (e.g. needs a physical device, CAPTCHA, email inbox).",
    "- priority: HIGH for core business flows and security, LOW for cosmetic checks.",
    "- Use answered clarifications as facts. Do not duplicate existing test cases listed in the input.",
    "",
    dataGuard(boundary),
  ].join("\n");
}
