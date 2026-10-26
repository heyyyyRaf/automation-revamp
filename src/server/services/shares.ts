import type { AuthContext } from "@/server/auth/session";
import { assertShareLookupAllowed, recordShareMiss } from "@/server/auth/rate-limit";
import { generateToken, sha256 } from "@/server/auth/tokens";
import { isValidId, requireProjectAccess } from "@/server/authz/guards";
import { db } from "@/server/db";
import { conflict, notFound } from "@/server/errors";
import { FINAL_RUN } from "@/server/runs/finish";
import { audit } from "@/server/services/audit";
import { buildRunReport, type RunReport } from "@/server/services/reports";
import { getStorage } from "@/server/storage/storage";

interface Meta {
  ip: string;
  requestId: string;
}

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

async function finishedRun(projectId: string, runId: string) {
  if (!isValidId(runId)) throw notFound("Run");
  const run = await db.run.findFirst({
    where: { id: runId, projectId },
    select: { id: true, status: true },
  });
  if (!run) throw notFound("Run");
  return run;
}

/** Active public links of a run (never the tokens: only their hashes are stored). */
export async function listShares(auth: AuthContext, projectId: string, runId: string) {
  await requireProjectAccess(auth, projectId, "reports:share", { allowArchived: true });
  const run = await finishedRun(projectId, runId);
  return db.reportShare.findMany({
    where: { runId: run.id, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { id: true, expiresAt: true, createdAt: true, createdBy: { select: { name: true } } },
  });
}

/**
 * FR-9.4 option (b): the Lead can turn on a read-only public link to one finished run report
 * that expires after 1, 7 or 30 days. The token is returned once.
 */
export async function createShare(
  auth: AuthContext,
  projectId: string,
  runId: string,
  days: 1 | 7 | 30,
  meta: Meta,
) {
  await requireProjectAccess(auth, projectId, "reports:share", { allowArchived: true });
  const run = await finishedRun(projectId, runId);
  if (!FINAL_RUN.includes(run.status))
    throw conflict("A report can be shared once the run finishes.");
  const token = generateToken(32);
  const share = await db.reportShare.create({
    data: {
      runId: run.id,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + days * DAY_MS),
      createdById: auth.user.id,
    },
  });
  await audit({
    action: "report.share_create",
    entityType: "run",
    entityId: run.id,
    projectId,
    actorId: auth.user.id,
    metadata: { shareId: share.id, days, expiresAt: share.expiresAt.toISOString() },
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });
  return { id: share.id, token, path: `/share/${token}`, expiresAt: share.expiresAt };
}

export async function revokeShare(
  auth: AuthContext,
  projectId: string,
  runId: string,
  shareId: string,
  meta: Meta,
) {
  await requireProjectAccess(auth, projectId, "reports:share", { allowArchived: true });
  const run = await finishedRun(projectId, runId);
  if (!isValidId(shareId)) throw notFound("Share link");
  const share = await db.reportShare.findFirst({
    where: { id: shareId, runId: run.id, revokedAt: null },
  });
  if (!share) throw notFound("Share link");
  await db.reportShare.update({ where: { id: share.id }, data: { revokedAt: new Date() } });
  await audit({
    action: "report.share_revoke",
    entityType: "run",
    entityId: run.id,
    projectId,
    actorId: auth.user.id,
    metadata: { shareId: share.id },
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });
}

/** Unknown, revoked and expired links all look the same: "not found". */
async function resolveShare(token: string, ip: string) {
  await assertShareLookupAllowed(ip);
  const share = TOKEN_RE.test(token)
    ? await db.reportShare.findUnique({
        where: { tokenHash: sha256(token) },
        include: { run: { select: { id: true, projectId: true } } },
      })
    : null;
  if (!share || share.revokedAt || share.expiresAt <= new Date()) {
    await recordShareMiss(ip);
    throw notFound("Report");
  }
  return share;
}

/** What a public viewer sees: the report without internal addresses. */
export type SharedReport = Omit<RunReport, "run"> & { run: Omit<RunReport["run"], "baseUrl"> };

export async function getSharedReport(
  token: string,
  meta: Meta,
): Promise<{ report: SharedReport; expiresAt: Date }> {
  const share = await resolveShare(token, meta.ip);
  const full = await buildRunReport(share.run.projectId, share.run.id);
  const { baseUrl: _baseUrl, ...run } = full.run;
  await audit({
    action: "report.share_view",
    entityType: "run",
    entityId: share.run.id,
    projectId: share.run.projectId,
    actorId: null,
    metadata: { shareId: share.id },
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });
  return { report: { ...full, run }, expiresAt: share.expiresAt };
}

/** A failure screenshot of the shared run only. */
export async function getSharedScreenshot(token: string, runTestId: string, ip: string) {
  const share = await resolveShare(token, ip);
  if (!isValidId(runTestId)) throw notFound("Screenshot");
  const t = await db.runTest.findFirst({
    where: { id: runTestId, runId: share.run.id, status: { in: ["FAILED", "ERROR"] } },
    select: { screenshotKey: true },
  });
  if (!t?.screenshotKey) throw notFound("Screenshot");
  return { bytes: await getStorage().get(t.screenshotKey), mimeType: "image/png" };
}
