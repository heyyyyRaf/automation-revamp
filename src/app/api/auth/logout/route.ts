import { NextResponse } from "next/server";
import { clearedSessionCookies } from "@/server/auth/cookies";
import { deleteSession } from "@/server/auth/session";
import { route } from "@/server/http/handler";
import { audit } from "@/server/services/audit";

export const POST = route(async ({ auth, ip, requestId }) => {
  await deleteSession(auth.sessionId);
  await audit({
    action: "auth.logout",
    entityType: "user",
    entityId: auth.user.id,
    actorId: auth.user.id,
    ipAddress: ip,
    requestId,
  });
  const res = NextResponse.json({ ok: true });
  for (const c of clearedSessionCookies()) res.cookies.set(c);
  return res;
});
