import { z } from "zod";
import type { ExportFormat } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { renderDocx } from "@/server/exports/render-docx";
import { renderPdf } from "@/server/exports/render-pdf";
import { printReportPdf, renderReportPage } from "@/server/exports/report-files";
import { renderXlsx } from "@/server/exports/render-xlsx";
import { buildTestScope } from "@/server/exports/test-scope";
import { JobFailure, type JobHandler } from "@/server/jobs/runner";
import { buildRunReport } from "@/server/services/reports";
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

export const exportHandler: JobHandler = async ({ job, signal }) => {
  const parsed = payloadSchema.safeParse(job.payload);
  if (!parsed.success) throw new JobFailure("This export request is incomplete.", false);
  const exp = await db.export.findFirst({
    where: { id: parsed.data.exportId, projectId: job.projectId },
    include: { createdBy: { select: { name: true } } },
  });
  if (!exp) throw new JobFailure("This export no longer exists.", false);
  if (exp.kind === "RUN_REPORT") return runReportExport(job.projectId, job.id, exp, signal);
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

/** FR-9.4: the run report as a self-contained HTML page, or that page printed to PDF. */
async function runReportExport(
  projectId: string,
  jobId: string,
  exp: { id: string; runId: string | null; format: ExportFormat },
  signal: AbortSignal,
) {
  if (!exp.runId || (exp.format !== "PDF" && exp.format !== "HTML")) {
    throw new JobFailure("This export type isn't available.", false);
  }
  await db.export.update({ where: { id: exp.id }, data: { status: "RUNNING", error: null } });
  const report = await buildRunReport(projectId, exp.runId);
  const html = await renderReportPage(report);
  let bytes: Buffer;
  if (exp.format === "HTML") bytes = Buffer.from(html, "utf8");
  else {
    try {
      bytes = await printReportPdf(html, `pdf-${jobId}`, signal);
    } catch {
      throw new JobFailure(
        "The PDF couldn't be printed. Try again, or download the HTML report.",
        true,
      );
    }
  }
  const storageKey = newObjectKey(projectId, "artifacts");
  const mime = exp.format === "PDF" ? EXPORT_MIME.PDF : "text/html; charset=utf-8";
  await getStorage().put(storageKey, bytes, mime);
  await db.export.update({
    where: { id: exp.id },
    data: {
      status: "SUCCEEDED",
      storageKey,
      fileName: sanitizeDisplayName(
        `${report.project.name} - Run ${report.run.number} report.${exp.format === "PDF" ? "pdf" : "html"}`,
      ),
    },
  });
  return { bytes: bytes.length };
}
