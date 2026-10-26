import type { z } from "zod";
import type { targetDecisionSchema } from "@/lib/validation";
import type { AuthContext } from "@/server/auth/session";
import { isValidId, requirePermission, requireProjectAccess } from "@/server/authz/guards";
import { db } from "@/server/db";
import { badRequest, conflict, notFound } from "@/server/errors";
import { classifyAddress, normalizeOrigin, systemResolver } from "@/server/net/url-guard";
import { audit } from "@/server/services/audit";

interface Meta {
  ip: string;
  requestId: string;
}

export const TARGET_SELECT = {
  id: true,
  origin: true,
  allowPrivateNetwork: true,
  status: true,
  note: true,
  createdAt: true,
  decidedAt: true,
  requestedBy: { select: { name: true } },
  decidedBy: { select: { name: true } },
} as const;

export type NetworkHint = "public" | "private" | "blocked" | "unresolved";

/** What the target's host resolves to right now — shown to the Admin before approving. */
export async function networkHint(origin: string): Promise<NetworkHint> {
  const host = new URL(origin).hostname.replace(/^\[|\]$/g, "");
  try {
    const addresses = await systemResolver(host);
    const verdicts = addresses.map(classifyAddress);
    if (verdicts.includes("blocked")) return "blocked";
    if (verdicts.includes("private")) return "private";
    return verdicts.length ? "public" : "unresolved";
  } catch {
    return "unresolved";
  }
}

export async function listTargets(auth: AuthContext, projectId: string) {
  await requireProjectAccess(auth, projectId, "projects:read");
  const rows = await db.allowedTarget.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
    select: TARGET_SELECT,
  });
  return Promise.all(rows.map(async (t) => ({ ...t, network: await networkHint(t.origin) })));
}

export async function requestTarget(
  auth: AuthContext,
  projectId: string,
  input: { url: string; note?: string | undefined },
  meta: Meta,
) {
  await requireProjectAccess(auth, projectId, "targets:request");
  const origin = normalizeOrigin(input.url);
  if (!origin) throw badRequest("Enter a web address like https://staging.example.com.");
  if ((await networkHint(origin)) === "blocked") {
    throw badRequest(
      "This address points to a reserved or metadata network and can never be tested.",
    );
  }
  const existing = await db.allowedTarget.findUnique({
    where: { projectId_origin: { projectId, origin } },
  });
  if (existing && existing.status !== "REVOKED")
    throw conflict("This address has already been requested.");
  const target = existing
    ? await db.allowedTarget.update({
        where: { id: existing.id },
        data: {
          status: "PENDING",
          requestedById: auth.user.id,
          decidedById: null,
          decidedAt: null,
          note: input.note ?? null,
        },
      })
    : await db.allowedTarget.create({
        data: { projectId, origin, requestedById: auth.user.id, note: input.note ?? null },
      });
  await audit({
    action: "target.request",
    entityType: "allowed_target",
    entityId: target.id,
    projectId,
    actorId: auth.user.id,
    metadata: { origin },
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });
  return target;
}

/** Admin only. Approving decides, explicitly, whether private-network addresses are allowed. */
export async function decideTarget(
  auth: AuthContext,
  projectId: string,
  targetId: string,
  input: z.infer<typeof targetDecisionSchema>,
  meta: Meta,
) {
  requirePermission(auth, "targets:approve");
  await requireProjectAccess(auth, projectId, "targets:approve");
  if (!isValidId(targetId)) throw notFound("Target");
  const target = await db.allowedTarget.findFirst({ where: { id: targetId, projectId } });
  if (!target) throw notFound("Target");
  const approve = input.decision === "APPROVE";
  const updated = await db.allowedTarget.update({
    where: { id: target.id },
    data: {
      status: approve ? "APPROVED" : "REVOKED",
      allowPrivateNetwork: approve ? input.allowPrivateNetwork : false,
      decidedById: auth.user.id,
      decidedAt: new Date(),
      ...(input.note !== undefined ? { note: input.note } : {}),
    },
  });
  await audit({
    action: approve ? "target.approve" : "target.revoke",
    entityType: "allowed_target",
    entityId: target.id,
    projectId,
    actorId: auth.user.id,
    metadata: { origin: target.origin, allowPrivateNetwork: updated.allowPrivateNetwork },
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });
  return updated;
}

/** The approved target an environment points at, or a clear error if it was revoked. */
export async function requireApprovedTarget(projectId: string, baseUrl: string) {
  const origin = normalizeOrigin(baseUrl);
  const target = origin
    ? await db.allowedTarget.findUnique({ where: { projectId_origin: { projectId, origin } } })
    : null;
  if (!target || target.status !== "APPROVED") {
    throw conflict(
      "This environment's address is not approved (or approval was revoked). Ask an Admin.",
    );
  }
  return target;
}
