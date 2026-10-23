import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sessionCookieName } from "@/server/auth/cookies";
import { validateSessionToken, type AuthContext } from "@/server/auth/session";

/** For server components / layouts. API routes use `route()` instead. */
export async function getAuth(): Promise<AuthContext | null> {
  const store = await cookies();
  return validateSessionToken(store.get(sessionCookieName())?.value);
}

export async function requireAuthPage(): Promise<AuthContext> {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  return auth;
}
