import "dotenv/config";
import { afterAll, beforeEach } from "vitest";

// Must run before any server module is imported (db.ts reads DATABASE_URL at import time).
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
Object.assign(process.env, {
  NODE_ENV: "test",
  APP_URL: "http://localhost:3000",
  LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? "silent",
  REDIS_URL: "redis://unused-in-tests:6379",
  S3_ENDPOINT: "http://unused-in-tests:9000",
  S3_ACCESS_KEY_ID: "test",
  S3_SECRET_ACCESS_KEY: "test-secret",
  S3_BUCKET: "test-bucket",
  JOB_TIMEOUT_SECONDS: "30",
});

const { resetEnvCache } = await import("@/server/env");
const { setStorage, MemoryStorage } = await import("@/server/storage/storage");
const { setDispatcher, RecordingDispatcher } = await import("@/server/jobs/dispatcher");
const { useInMemoryLoginLimiters } = await import("@/server/auth/rate-limit");
const { db } = await import("@/server/db");
const { setAIProvider } = await import("@/server/ai/provider");
const { FakeProvider } = await import("@/server/ai/fake-provider");
const { setFigmaFetch } = await import("@/server/figma/figma");

resetEnvCache();

beforeEach(async () => {
  setStorage(new MemoryStorage());
  setDispatcher(new RecordingDispatcher());
  useInMemoryLoginLimiters();
  setAIProvider(new FakeProvider());
  // No real network calls from tests: Figma tests install their own fake.
  setFigmaFetch((async () => {
    throw new Error("unexpected network call in test");
  }) as typeof fetch);
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length > 0) {
    const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
    await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  }
});

afterAll(async () => {
  await db.$disconnect();
});
