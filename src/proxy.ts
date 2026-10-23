import { NextResponse, type NextRequest } from "next/server";
import { HSTS } from "@/security-headers";

/**
 * Builds a strict, per-request nonce-based CSP for HTML pages.
 * `https` is decided from APP_URL at runtime (not NODE_ENV), so a production build served over
 * plain http://localhost (docker compose) is not forced onto HTTPS.
 */
export function buildCsp(nonce: string, isDev: boolean, https: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    // Allows style="" attributes only (used by UI primitives for positioning), not <style> blocks.
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src 'self'${isDev ? " ws:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const https = (process.env.APP_URL ?? "").startsWith("https://");
  const csp = buildCsp(nonce, process.env.NODE_ENV === "development", https);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  if (!requestHeaders.has("x-request-id")) requestHeaders.set("x-request-id", crypto.randomUUID());

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);
  if (https) response.headers.set("strict-transport-security", HSTS);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
