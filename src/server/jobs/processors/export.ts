import { z } from "zod";
import type { ExportFormat } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { renderDocx } from "@/server/exports/render-docx";
import { renderPdf } from "@/server/exports/render-pdf";
import { renderXlsx } from "@/server/exports/render-xlsx";
import { buildTestScope } from "@/server/exports/test-scope";
import { JobFailure, type JobHandler } from "@/server/jobs/runner";
import { getStorage, newObjectKey } from "@/server/storage/storage";
import { sanitizeDisplayName } from "@/server/uploads/filename";

const payloadSchema = z.object({ exportId: z.string().min(1) });

export const EXPORT_MIME: Record<"PDF" | "XLSX" | "DOCX", string> = {
  PDF: "application/pdf",
  XLSX: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  DOCX: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

const EXTENSION: Record<"PDF" | "XLSX" | "DOCX", string> = {
  PDF: "pdf",
  XLSX: "xlsx",
  DOCX: "docx",
};

function isScopeFormat(f: ExportFormat): f is "PDF" | "XLSX" | "DOCX" {
  return f === "PDF" || f === "XLSX" || f === "DOCX";
}

export const exportHandler: JobHandler = async ({ job }) => {
  const parsed = payloadSchema.safeParse(job.payload);
  if (!parsed.success) throw new JobFailure("This export request is incomplete.", false);
  const exp = await db.export.findFirst({
    where: { id: parsed.data.exportId, projectId: job.projectId },
    include: { createdBy: { select: { name: true } } },
  });
  if (!exp) throw new JobFailure("This export no longer exists.", false);
  if (exp.kind !== "TEST_SCOPE" || !isScopeFormat(exp.format)) {
    throw new JobFailure("This export type isn't available yet.", false);
  }

  await db.export.update({ where: { id: exp.id }, data: { status: "RUNNING", error: null } });
  const scope = await buildTestScope(job.projectId, exp.createdBy.name);
  const bytes =
    exp.format === "PDF"
      ? await renderPdf(scope)
      : exp.format === "XLSX"
        ? await renderXlsx(scope)
        : await renderDocx(scope);

  const storageKey = newObjectKey(job.projectId, "artifacts");
  await getStorage().put(storageKey, bytes, EXPORT_MIME[exp.format]);
  const date = new Date().toISOString().slice(0, 10);
  await db.export.update({
    where: { id: exp.id },
    data: {
      status: "SUCCEEDED",
      storageKey,
      fileName: sanitizeDisplayName(
        `${scope.project.name} - Test scope ${date}.${EXTENSION[exp.format]}`,
      ),
    },
  });
  return { bytes: bytes.length };
};
