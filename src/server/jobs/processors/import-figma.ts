import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "@/server/db";
import { getEnv } from "@/server/env";
import { FigmaClient, parseFigmaLink } from "@/server/figma/figma";
import { JobFailure, type JobHandler } from "@/server/jobs/runner";
import { getStorage, newObjectKey } from "@/server/storage/storage";
import { sanitizeDisplayName } from "@/server/uploads/filename";
import { validateUpload } from "@/server/uploads/validate";
import { AppError } from "@/server/errors";

const MAX_FRAMES = 10;
const payloadSchema = z.object({ documentId: z.string().min(1) });

/**
 * Exports frames from a Figma link as PNGs and stores each one as a FIGMA image document
 * (linked to the link via derivedFromId), so AI analysis can look at the designs.
 */
export const importFigmaHandler: JobHandler = async ({ job, signal }) => {
  const parsed = payloadSchema.safeParse(job.payload);
  if (!parsed.success) throw new JobFailure("This job is missing its Figma link.", false);
  const token = getEnv().FIGMA_ACCESS_TOKEN;
  if (!token) {
    throw new JobFailure(
      "Figma import isn't set up yet. Ask an Admin to add a Figma access token, or upload PNG exports instead.",
      false,
    );
  }

  const linkDoc = await db.document.findFirst({
    where: {
      id: parsed.data.documentId,
      projectId: job.projectId,
      source: "LINK",
      deletedAt: null,
    },
  });
  const link = linkDoc?.linkUrl ? parseFigmaLink(linkDoc.linkUrl) : null;
  if (!linkDoc || !link) throw new JobFailure("This Figma link is no longer valid.", false);

  await db.document.update({
    where: { id: linkDoc.id },
    data: { extractionStatus: "PROCESSING", extractionError: null },
  });

  const client = new FigmaClient(token, signal);
  const frames = await client.listFrames(link, MAX_FRAMES);
  if (frames.length === 0) throw new JobFailure("This Figma file has no frames to import.", false);
  const rendered = await client.renderPngs(link.fileKey, frames);

  // Replace frames from a previous import of the same link.
  await db.document.updateMany({
    where: { derivedFromId: linkDoc.id, deletedAt: null },
    data: { deletedAt: new Date() },
  });

  let imported = 0;
  for (const { frame, png } of rendered) {
    let file;
    try {
      // Same checks as a manual upload: real PNG, re-encoded, size-limited.
      file = await validateUpload({
        bytes: png,
        fileName: "frame.png",
        category: "FIGMA",
        maxBytes: 25 * 1024 * 1024,
      });
    } catch (err) {
      if (err instanceof AppError) continue;
      throw err;
    }
    const storageKey = newObjectKey(job.projectId, "documents");
    await getStorage().put(storageKey, file.bytes, file.mimeType);
    await db.document.create({
      data: {
        projectId: job.projectId,
        category: "FIGMA",
        source: "FILE",
        originalName: sanitizeDisplayName(`Figma - ${frame.name}.png`),
        mimeType: file.mimeType,
        sizeBytes: file.bytes.length,
        storageKey,
        sha256: createHash("sha256").update(file.bytes).digest("hex"),
        extractionStatus: "NOT_APPLICABLE",
        derivedFromId: linkDoc.id,
        uploadedById: linkDoc.uploadedById,
      },
    });
    imported++;
  }
  if (imported === 0) throw new JobFailure("No frames could be imported from Figma.", false);

  await db.document.update({
    where: { id: linkDoc.id },
    data: {
      extractionStatus: "SUCCEEDED",
      pageCount: imported,
      extractionError:
        frames.length >= MAX_FRAMES ? `Imported the first ${MAX_FRAMES} frames.` : null,
    },
  });
  return { framesImported: imported };
};
