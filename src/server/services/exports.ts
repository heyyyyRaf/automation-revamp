import type { AuthContext } from "@/server/auth/session";
import { isValidId, requireProjectAccess } from "@/server/authz/guards";
import { db } from "@/server/db";
import { badRequest, notFound } from "@/server/errors";
import { enqueueJob } from "@/server/jobs/enqueue";
import { EXPORT_MIME } from "@/server/jobs/processors/export";
import { audit } from "@/server/services/audit";
import { getStorage } from "@/server/storage/storage";

interface Meta {
  ip: string;
  requestId: string;
}

/** HTML downloads are attachments with a sandbox CSP, so they never run on this origin. */
const DOWNLOAD_MIME = { ...EXPORT_MIME, HTML: "text/html; charset=utf-8" } as const;

const EXPORT_SELECT = {
  id: true,
  kind: true,
  format: true,
  status: true,
  fileName: true,
  error: true,
  createdAt: true,
  createdBy: { select: { name: true } },
} as const;

export async function createExport(
  auth: AuthContext,
  projectId: string,
  format: "PDF" | "XLSX" | "DOCX",
  meta: Meta,
) {
  // Reading data is enough to export it, including from archived projects.
  await requireProjectAccess(auth, projectId, "exports:create", { allowArchived: true });
  const exp = await db.export.create({
    data: { projectId, kind: "TEST_SCOPE", format, createdById: auth.user.id },
  });
  const job = await enqueueJob({
    projectId,
    type: "EXPORT",
    payload: { exportId: exp.id },
    createdById: auth.user.id,
  });
  await db.export.update({ where: { id: exp.id }, data: { jobId: job.id } });
  await audit({
    action: "export.create",
    entityType: "export",
    entityId: exp.id,
    projectId,
    actorId: auth.user.id,
    metadata: { kind: "TEST_SCOPE", format },
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });
  return db.export.findUniqueOrThrow({ where: { id: exp.id }, select: EXPORT_SELECT });
}

/** FR-9.4: download a run report as a self-contained HTML page or as a PDF. */
export async function createRunReportExport(
  auth: AuthContext,
  projectId: string,
  runId: string,
  format: "PDF" | "HTML",
  meta: Meta,
) {
  await requireProjectAccess(auth, projectId, "exports:create", { allowArchived: true });
  if (!isValidId(runId)) throw notFound("Run");
  const run = await db.run.findFirst({ where: { id: runId, projectId }, select: { status: true } });
  if (!run) throw notFound("Run");
  if (run.status === "QUEUED" || run.status === "RUNNING") {
    throw badRequest("The report is ready once the run finishes.");
  }
  const exp = await db.export.create({
    data: { projectId, kind: "RUN_REPORT", format, runId, createdById: auth.user.id },
  });
  const job = await enqueueJob({
    projectId,
    type: "EXPORT",
    payload: { exportId: exp.id },
    createdById: auth.user.id,
  });
  await db.export.update({ where: { id: exp.id }, data: { jobId: job.id } });
  await audit({
    action: "export.create",
    entityType: "export",
    entityId: exp.id,
    projectId,
    actorId: auth.user.id,
    metadata: { kind: "RUN_REPORT", format, runId },
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });
  return db.export.findUniqueOrThrow({ where: { id: exp.id }, select: EXPORT_SELECT });
}

/** Test-scope exports for the project, or the report exports of one run. */
export async function listExports(auth: AuthContext, projectId: string, runId?: string) {
  await requireProjectAccess(auth, projectId, "projects:read");
  if (runId !== undefined && !isValidId(runId)) throw notFound("Run");
  return db.export.findMany({
    where: runId ? { projectId, kind: "RUN_REPORT", runId } : { projectId, kind: "TEST_SCOPE" },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: EXPORT_SELECT,
  });
}

export async function getExportFile(
  auth: AuthContext,
  projectId: string,
  exportId: string,
  meta: Meta,
) {
  await requireProjectAccess(auth, projectId, "projects:read");
  if (!isValidId(exportId)) throw notFound("Export");
  const exp = await db.export.findFirst({ where: { id: exportId, projectId } });
  if (!exp) throw notFound("Export");
  if (exp.status !== "SUCCEEDED" || !exp.storageKey)
    throw badRequest("This export isn't ready yet.");
  if (!(exp.format in DOWNLOAD_MIME)) throw notFound("Export");
  const bytes = await getStorage().get(exp.storageKey);
  await audit({
    action: "export.download",
    entityType: "export",
    entityId: exp.id,
    projectId,
    actorId: auth.user.id,
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });
  return {
    bytes,
    mimeType: DOWNLOAD_MIME[exp.format as keyof typeof DOWNLOAD_MIME],
    fileName: exp.fileName ?? `export.${exp.format.toLowerCase()}`,
  };
}
