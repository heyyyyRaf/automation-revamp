import { z } from "zod";
import { dataGuard } from "@/server/ai/prompt";

export const REQUIREMENT_TYPES = [
  "FUNCTIONAL",
  "NON_FUNCTIONAL",
  "BUSINESS_RULE",
  "UI",
  "DATA",
  "SECURITY",
  "OTHER",
] as const;

/** What the model must return for one chunk of documents / one batch of images. */
export const analysisOutputSchema = z.object({
  requirements: z
    .array(
      z.object({
        ref: z.string().min(1).max(12),
        text: z.string().trim().min(5).max(2000),
        type: z.enum(REQUIREMENT_TYPES),
        /** The DOC-n / IMG-n id of the source block. */
        source: z.string().max(20),
        section: z.string().max(200).nullable(),
      }),
    )
    .max(150),
  userFlows: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        description: z.string().max(2000),
        steps: z.array(z.string().trim().min(1).max(500)).min(1).max(40),
      }),
    )
    .max(30),
  openQuestions: z
    .array(
      z.object({
        question: z.string().trim().min(5).max(1000),
        relatedRef: z.string().max(12).nullable(),
      }),
    )
    .max(50),
});

export type AnalysisOutput = z.infer<typeof analysisOutputSchema>;

export function analysisSystemPrompt(boundary: string): string {
  return [
    "You are a senior QA analyst. Extract testable information from the project material provided.",
    "",
    "Return:",
    "- requirements: ATOMIC requirements — one testable behaviour each. Split compound sentences.",
    "  Keep the original meaning and wording where possible; do not invent behaviour.",
    "  ref: a short local id (R1, R2, ...). source: the id of the block it came from (e.g. DOC-1, IMG-2).",
    "  section: the heading, page or area it came from, or null.",
    "- userFlows: end-to-end journeys a user takes, as ordered steps.",
    "- openQuestions: ambiguities, gaps or contradictions a tester must clarify before testing.",
    "  relatedRef: the ref of the requirement it concerns, or null.",
    "If the material contains no requirements, return empty arrays.",
    "",
    dataGuard(boundary),
  ].join("\n");
}
