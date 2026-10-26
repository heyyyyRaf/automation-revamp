// Local (unsandboxed) runner mode for tests. Never allowed in production (see getSandbox()).
Object.assign(process.env, {
  NODE_ENV: "test",
  APP_URL: "http://localhost:3000",
  LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? "silent",
  DATABASE_URL: "postgresql://unused/unused",
  REDIS_URL: "redis://unused:6379",
  S3_ENDPOINT: "http://unused:9000",
  S3_ACCESS_KEY_ID: "test",
  S3_SECRET_ACCESS_KEY: "test-secret",
  S3_BUCKET: "test-bucket",
  SANDBOX_MODE: "local",
});
const { resetEnvCache } = await import("@/server/env");
resetEnvCache();

export {};
