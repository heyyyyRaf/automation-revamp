import { z } from "zod";

const bool = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(3),
  S3_FORCE_PATH_STYLE: bool,

  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(12),
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(25).default(25),

  /** Max pages to OCR when a PDF has no text layer. */
  OCR_MAX_PAGES: z.coerce.number().int().min(1).max(200).default(30),
  /** Hard timeout for one background job, in seconds. */
  JOB_TIMEOUT_SECONDS: z.coerce.number().int().min(10).max(3600).default(300),

  /** AI provider. "fake" is an offline, deterministic provider for tests and demos. */
  AI_PROVIDER: z.enum(["openai", "fake"]).default("openai"),
  /** Server-side only. Never sent to the browser or logged. */
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().min(1).optional(),
  /** Optional OpenAI-compatible endpoint (e.g. a company gateway). */
  OPENAI_BASE_URL: z.url().optional(),
  /** Default monthly token cap per project (input + output); projects can override. */
  AI_MONTHLY_TOKEN_CAP: z.coerce.number().int().min(1000).default(2_000_000),
  /** Max diagram / design images sent to the AI per analysis. */
  AI_MAX_IMAGES: z.coerce.number().int().min(0).max(50).default(12),
  /** Hard timeout for AI jobs (analysis, generation), in seconds. */
  AI_JOB_TIMEOUT_SECONDS: z.coerce.number().int().min(30).max(7200).default(1200),

  /** Server-side only. Personal access token used to export frames from Figma links. */
  FIGMA_ACCESS_TOKEN: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/**
 * Validated server environment. Parsed lazily so `next build` does not need runtime secrets.
 * Throws a readable error listing only variable *names* (never values).
 */
export function getEnv(): Env {
  if (cached) return cached;
  // Docker Compose passes unset optional variables as "": treat those as not set.
  const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ""));
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const names = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid or missing environment variables: ${names}`);
  }
  cached = parsed.data;
  return cached;
}

/** For tests only. */
export function resetEnvCache(): void {
  cached = undefined;
}

export function isSecureCookie(env: Env = getEnv()): boolean {
  return env.APP_URL.startsWith("https://");
}
