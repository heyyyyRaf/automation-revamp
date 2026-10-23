import { Redis } from "ioredis";
import { getEnv } from "@/server/env";
import { logger } from "@/server/logger";

let shared: Redis | undefined;

/** At most one connection-error log line per client per interval during an outage. */
const ERROR_LOG_INTERVAL_MS = 30_000;

/** Shared Redis client for rate limiting and queue producers. */
export function getRedis(): Redis {
  shared ??= createRedis();
  return shared;
}

/** BullMQ workers need their own connection with `maxRetriesPerRequest: null`. */
export function createRedis(options: { forWorker?: boolean } = {}): Redis {
  const client = new Redis(getEnv().REDIS_URL, {
    // Producers fail fast (bounded retries) instead of hanging a request; workers wait for Redis.
    maxRetriesPerRequest: options.forWorker ? null : 3,
    connectTimeout: 5_000,
  });
  let lastLog = 0;
  client.on("error", (err: Error) => {
    const now = Date.now();
    if (now - lastLog < ERROR_LOG_INTERVAL_MS) return;
    lastLog = now;
    // The message only — the error object can include the connection URL with its password.
    logger.warn({ redisError: err.message }, "redis connection problem");
  });
  return client;
}
