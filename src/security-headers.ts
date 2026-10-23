/**
 * Static security headers applied to every response (helmet equivalent).
 * CSP and HSTS are set per request in proxy.ts, because they depend on runtime config.
 */
export function securityHeaders(): { key: string; value: string }[] {
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
    { key: "X-DNS-Prefetch-Control", value: "off" },
    { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    },
  ];
}

/** Only sent when APP_URL is https. */
export const HSTS = "max-age=63072000; includeSubDomains; preload";

/** API responses are JSON/downloads: nothing may execute or be framed. */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'; sandbox";
