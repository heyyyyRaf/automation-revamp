import {
  RateLimiterMemory,
  RateLimiterRedis,
  RateLimiterRes,
  type RateLimiterAbstract,
} from "rate-limiter-flexible";
import { getRedis } from "@/server/queue/connection";
import { tooManyRequests } from "@/server/errors";

const WINDOW_SECONDS = 15 * 60;

interface LoginLimiters {
  /** Failed attempts for one email from one IP. */
  emailIp: RateLimiterAbstract;
  /** Failed attempts for one email from anywhere (stops IP rotation). */
  email: RateLimiterAbstract;
  /** All failed attempts from one IP (stops credential stuffing across many emails). */
  ip: RateLimiterAbstract;
}

let limiters: LoginLimiters | undefined;

function build(make: (keyPrefix: string, points: number) => RateLimiterAbstract): LoginLimiters {
  return {
    emailIp: make("login_email_ip", 5),
    email: make("login_email", 20),
    ip: make("login_ip", 50),
  };
}

function getLimiters(): LoginLimiters {
  limiters ??= build((keyPrefix, points) => {
    const memoryFallback = new RateLimiterMemory({ keyPrefix, points, duration: WINDOW_SECONDS });
    return new RateLimiterRedis({
      storeClient: getRedis(),
      keyPrefix,
      points,
      duration: WINDOW_SECONDS,
      // If Redis is down, keep limiting in-process rather than failing open.
      insuranceLimiter: memoryFallback,
    });
  });
  return limiters;
}

/** Tests use in-memory limiters. */
export function useInMemoryLoginLimiters(): void {
  limiters = build(
    (keyPrefix, points) => new RateLimiterMemory({ keyPrefix, points, duration: WINDOW_SECONDS }),
  );
}

function keys(email: string, ip: string) {
  return { emailIp: `${email}|${ip}`, email, ip };
}

/** Throws 429 if any limit is already exhausted. */
export async function assertLoginAllowed(email: string, ip: string): Promise<void> {
  const l = getLimiters();
  const k = keys(email, ip);
  const results = await Promise.all([
    l.emailIp.get(k.emailIp),
    l.email.get(k.email),
    l.ip.get(k.ip),
  ]);
  const limits = [l.emailIp.points, l.email.points, l.ip.points];
  let retryMs = 0;
  results.forEach((res, i) => {
    if (res && res.consumedPoints >= (limits[i] ?? 0))
      retryMs = Math.max(retryMs, res.msBeforeNext);
  });
  if (retryMs > 0) throw tooManyRequests(Math.ceil(retryMs / 1000));
}

export async function recordLoginFailure(email: string, ip: string): Promise<void> {
  const l = getLimiters();
  const k = keys(email, ip);
  await Promise.all(
    [l.emailIp.consume(k.emailIp), l.email.consume(k.email), l.ip.consume(k.ip)].map((p) =>
      p.catch((e: unknown) => {
        // Exhausting the limit rejects with RateLimiterRes — expected, not an error.
        if (!(e instanceof RateLimiterRes)) throw e;
      }),
    ),
  );
}

export async function recordLoginSuccess(email: string, ip: string): Promise<void> {
  const l = getLimiters();
  await l.emailIp.delete(keys(email, ip).emailIp);
}
