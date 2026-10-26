import { z } from "zod";
import { REQUIREMENT_TYPES } from "@/lib/domain";

/** What the model must return for one chunk of a document. */
export const analysisOutputSchema = z.object({
  requirements: z
    .array(
      z.object({
        ref: z.string().min(1).max(12),
        text: z.string().trim().min(5).max(2000),
        type: z.enum(REQUIREMENT_TYPES),
        /** The DOC-n id of the source block. */
        source: z.string().max(20),
        /** NFR-7: page and/or heading, so a reviewer can verify it. */
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

/** FR-2.2: what the vision model returns for an image (flow diagram or Figma frame). */
export const imageDescriptionSchema = z.object({
  description: z.string().trim().min(1).max(30_000),
});
