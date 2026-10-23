import { Redis } from "ioredis";
import { getEnv } from "@/server/env";

let shared: Redis | undefined;

/** Shared Redis client for rate limiting and queue producers. */
export function getRedis(): Redis {
  shared ??= createRedis();
  return shared;
}

/** BullMQ workers need their own connection with `maxRetriesPerRequest: null`. */
export function createRedis(options: { forWorker?: boolean } = {}): Redis {
  return new Redis(getEnv().REDIS_URL, {
    // Producers fail fast (bounded retries) instead of hanging a request; workers wait for Redis.
    maxRetriesPerRequest: options.forWorker ? null : 3,
    connectTimeout: 5_000,
  });
}
