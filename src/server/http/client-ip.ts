/**
 * Client IP from X-Forwarded-For.
 *
 * Next.js only sets X-Forwarded-For when it is absent, so a client can forge it.
 * In production run behind a reverse proxy that *appends* the real address and set
 * TRUSTED_PROXY_HOPS to the number of proxies; we then read the entry those proxies added.
 * With 0 hops (local dev) we take the last entry as a best effort — the login limiter also
 * limits per email, so a forged IP cannot bypass it.
 */
export function getClientIp(headers: Headers, trustedHops = trustedProxyHops()): string {
  const parts = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return "unknown";
  const index = trustedHops > 0 ? Math.max(0, parts.length - trustedHops) : parts.length - 1;
  return (parts[index] ?? "unknown").slice(0, 64);
}

function trustedProxyHops(): number {
  const n = Number(process.env.TRUSTED_PROXY_HOPS ?? "0");
  return Number.isInteger(n) && n >= 0 && n <= 5 ? n : 0;
}
