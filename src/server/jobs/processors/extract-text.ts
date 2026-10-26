import { z } from "zod";
import { describeImage } from "@/server/ai/tasks/describe-image";
import { db } from "@/server/db";
import { getEnv } from "@/server/env";
import { ExtractionError, extractDocumentText } from "@/server/extraction/extract";
import { toJobFailure } from "@/server/jobs/ai-errors";
import { JobFailure, type JobHandler } from "@/server/jobs/runner";
import { getStorage } from "@/server/storage/storage";
import { EXTRACTABLE_KINDS, kindFromMime } from "@/server/uploads/validate";

const payloadSchema = z.object({ documentId: z.string().min(1) });

export const extractTextHandler: JobHandler = async ({ job, signal }) => {
  const parsed = payloadSchema.safeParse(job.payload);
  if (!parsed.success) throw new JobFailure("This job is missing its document.", false);

  const doc = await db.document.findFirst({
    where: { id: parsed.data.documentId, projectId: job.projectId, deletedAt: null },
  });
  if (!doc?.storageKey || !doc.mimeType) {
    throw new JobFailure("The file is no longer available.", false);
  }
  const kind = kindFromMime(doc.mimeType);
  const isImage = kind === "png" || kind === "jpg";
  if (!kind || (!isImage && !EXTRACTABLE_KINDS.has(kind))) {
    throw new JobFailure("Text extraction is not available for this file type.", false);
  }

  await db.document.update({
    where: { id: doc.id },
    data: { extractionStatus: "PROCESSING", extractionError: null },
  });

  if (isImage) {
    // FR-2.2: diagrams and design frames are read by the vision model.
    let description: string;
    try {
      description = await describeImage(
        { projectId: job.projectId, jobId: job.id, purpose: "EXTRACT_TEXT" },
        doc,
        signal,
      );
    } catch (err) {
      throw toJobFailure(err);
    }
    await db.document.update({
      where: { id: doc.id },
      data: { extractionStatus: "SUCCEEDED", extractedText: description, pageCount: 1 },
    });
    return { characters: description.length, vision: true };
  }

  const bytes = await getStorage().get(doc.storageKey); // storage errors are retried

  let result;
  try {
    result = await extractDocumentText(kind, bytes, {
      ocrMaxPages: getEnv().OCR_MAX_PAGES,
      signal,
    });
  } catch (err) {
    if (err instanceof ExtractionError) throw new JobFailure(err.userMessage, false);
    throw err;
  }

  if (!result.text) {
    throw new JobFailure("We couldn't find any readable text in this file.", false);
  }

  await db.document.update({
    where: { id: doc.id },
    data: {
      extractionStatus: "SUCCEEDED",
      extractedText: result.text,
      pageCount: result.pageCount,
      ocrUsed: result.ocrUsed,
      extractionError: result.truncated
        ? "This document is very long; only the first part was kept."
        : null,
    },
  });

  return { characters: result.text.length, pageCount: result.pageCount, ocrUsed: result.ocrUsed };
};
