import sharp from "sharp";
import type { Document, JobType } from "@/generated/prisma/client";
import { newBoundary, untrusted } from "@/server/ai/prompt";
import { DESCRIBE_IMAGE_PROMPT } from "@/server/ai/prompts/library";
import { promptRef, systemPrompt } from "@/server/ai/prompts/template";
import { runStructured } from "@/server/ai/run";
import { imageDescriptionSchema } from "@/server/ai/tasks/analysis";
import { getStorage } from "@/server/storage/storage";

const MAX_IMAGE_PX = 1600;

export function isImageDocument(
  doc: Pick<Document, "source" | "storageKey" | "mimeType">,
): boolean {
  return (
    doc.source === "FILE" &&
    Boolean(doc.storageKey) &&
    (doc.mimeType === "image/png" || doc.mimeType === "image/jpeg")
  );
}

function imageKind(doc: Pick<Document, "typeTag">): string {
  switch (doc.typeTag) {
    case "FLOW_DIAGRAM":
      return "flow diagram";
    case "FIGMA":
      return "screen design (Figma frame)";
    default:
      return "image (a screen, a diagram or a screenshot)";
  }
}

/**
 * FR-2.2: turns a flow diagram or design frame into plain text with the vision model, so it
 * is analysed like any other document and the tester can read what the AI saw.
 */
export async function describeImage(
  ctx: { projectId: string; jobId?: string | undefined; purpose: JobType },
  doc: Pick<Document, "storageKey" | "originalName" | "typeTag">,
  signal?: AbortSignal,
): Promise<string> {
  const original = await getStorage().get(doc.storageKey ?? "");
  const data = await sharp(original)
    .resize({ width: MAX_IMAGE_PX, height: MAX_IMAGE_PX, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
  const boundary = newBoundary();
  const out = await runStructured(
    { projectId: ctx.projectId, jobId: ctx.jobId },
    {
      purpose: ctx.purpose,
      promptVersion: promptRef(DESCRIBE_IMAGE_PROMPT),
      system: systemPrompt(DESCRIBE_IMAGE_PROMPT, boundary, { kind: imageKind(doc) }),
      content: [
        {
          type: "text",
          text: `Describe this image.\n\n${untrusted(boundary, "file name", doc.originalName)}`,
        },
        { type: "image", mimeType: "image/jpeg", data },
      ],
      schema: imageDescriptionSchema,
      schemaName: "image_description",
      maxOutputTokens: 4_000,
      ...(signal ? { signal } : {}),
    },
  );
  return out.description;
}
