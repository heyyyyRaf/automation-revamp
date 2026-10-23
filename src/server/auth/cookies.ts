import { isSecureCookie } from "@/server/env";

/** `__Host-` prefix (Secure, Path=/, no Domain) is only valid over HTTPS. */
export function sessionCookieName(secure = isSecureCookie()): string {
  return secure ? "__Host-tqa_session" : "tqa_session";
}

/** Readable by JS so the client can echo it in the `x-csrf-token` header. Not a secret on its own. */
export function csrfCookieName(secure = isSecureCookie()): string {
  return secure ? "__Host-tqa_csrf" : "tqa_csrf";
}

export const CSRF_HEADER = "x-csrf-token";

export interface CookieSpec {
  name: string;
  value: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  expires: Date;
}

export function sessionCookies(token: string, csrfToken: string, expires: Date): CookieSpec[] {
  const secure = isSecureCookie();
  return [
    {
      name: sessionCookieName(secure),
      value: token,
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      expires,
    },
    {
      name: csrfCookieName(secure),
      value: csrfToken,
      httpOnly: false,
      secure,
      sameSite: "lax",
      path: "/",
      expires,
    },
  ];
}

export function clearedSessionCookies(): CookieSpec[] {
  return sessionCookies("", "", new Date(0));
}
