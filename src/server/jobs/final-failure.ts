import type { Job } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { logger } from "@/server/logger";

/** Propagates a job's final failure to the record it was working on, so the UI shows it. */
export async function onFinalFailure(job: Job, message: string): Promise<void> {
  try {
    switch (job.type) {
      case "EXTRACT_TEXT":
      case "IMPORT_FIGMA": {
        const documentId = payloadString(job, "documentId");
        if (documentId) {
          await db.document.updateMany({
            where: { id: documentId, projectId: job.projectId },
            data: { extractionStatus: "FAILED", extractionError: message },
          });
        }
        break;
      }
      case "EXPORT": {
        const exportId = payloadString(job, "exportId");
        if (exportId) {
          await db.export.updateMany({
            where: { id: exportId, projectId: job.projectId },
            data: { status: "FAILED", error: message },
          });
        }
        break;
      }
      default:
        break;
    }
  } catch (err) {
    logger.error({ err, jobId: job.id }, "failed to propagate job failure");
  }
}

function payloadString(job: Job, key: string): string | undefined {
  const p = job.payload;
  if (p && typeof p === "object" && !Array.isArray(p)) {
    const v = (p as Record<string, unknown>)[key];
    return typeof v === "string" ? v : undefined;
  }
  return undefined;
}
