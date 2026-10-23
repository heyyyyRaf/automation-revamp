import { NextResponse } from "next/server";
import { loginSchema } from "@/lib/validation";
import { sessionCookies } from "@/server/auth/cookies";
import { readJson, route } from "@/server/http/handler";
import { login } from "@/server/services/users";

export const POST = route({ auth: false }, async ({ req, ip, requestId }) => {
  const { email, password } = await readJson(req, loginSchema);
  const { user, session } = await login(email, password, {
    ip,
    requestId,
    userAgent: req.headers.get("user-agent") ?? undefined,
  });
  const res = NextResponse.json({ user });
  for (const c of sessionCookies(session.token, session.csrfToken, session.expiresAt)) {
    res.cookies.set(c);
  }
  return res;
});
