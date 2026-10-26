/**
 * Wire protocol between the worker, the launcher and the runner inside a sandbox.
 * Input: one JSON line on stdin, then control lines ("pause" | "resume" | "stop").
 * Output: NDJSON events on stdout. Everything coming back is untrusted: it is validated
 * here, size-limited, and scrubbed of secrets before it is stored or shown.
 * This module must stay dependency-light: it is bundled into the runner image.
 */
import { z } from "zod";

export const loginConfigSchema = z.object({
  path: z.string().startsWith("/").max(500),
  usernameLabel: z.string().min(1).max(100),
  passwordLabel: z.string().min(1).max(100),
  submitLabel: z.string().min(1).max(100),
  successText: z.string().max(200).nullable().optional(),
  successUrlContains: z.string().max(200).nullable().optional(),
});
export type LoginConfig = z.infer<typeof loginConfigSchema>;

const proxySchema = z.object({ server: z.string(), username: z.string(), password: z.string() });

export const runnerInputSchema = z.object({
  mode: z.enum(["run", "capture", "login", "pdf"]),
  baseURL: z.string().url(),
  proxy: proxySchema.nullable(),
  storageState: z.string().max(5_000_000).nullable(),
  accounts: z.record(z.string(), z.object({ username: z.string(), password: z.string() })),
  vars: z.record(z.string(), z.string()),
  testTimeoutMs: z.number().int().min(1000).max(1_800_000),
  /** FR-8.4: retries per failed test. */
  retries: z.number().int().min(0).max(3).default(0),
  /** Design "Slow motion": pause between browser actions. */
  slowMoMs: z.number().int().min(0).max(2000).default(0),
  tests: z
    .array(z.object({ id: z.string().regex(/^[a-z0-9]{10,40}$/), code: z.string().max(200_000) }))
    .max(500)
    .default([]),
  /** FRD step 4: capture each page of the flow (up to 5). */
  capture: z
    .object({ paths: z.array(z.string().startsWith("/").max(2000)).min(1).max(5) })
    .optional(),
  login: loginConfigSchema.extend({ account: z.string() }).optional(),
  /** FR-9.4: print a self-contained report page to PDF (no network). */
  pdf: z.object({ html: z.string().max(11_000_000) }).optional(),
});
export type RunnerInput = z.infer<typeof runnerInputSchema>;

const text = (max: number) => z.string().max(max);
const id = z.string().max(40);

export const domElementSchema = z.object({
  role: text(40).nullable(),
  name: text(300).nullable(),
  label: text(300).nullable(),
  placeholder: text(300).nullable(),
  testId: text(200).nullable(),
  text: text(300).nullable(),
  tag: text(20),
  type: text(30).nullable(),
});
export type DomElement = z.infer<typeof domElementSchema>;

export const domSnapshotSchema = z.object({
  url: text(2000),
  title: text(500),
  aria: text(80_000),
  elements: z.array(domElementSchema).max(600),
});
export type DomSnapshotData = z.infer<typeof domSnapshotSchema>;

export const runnerEventSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("ready") }),
  z.object({ t: z.literal("test-begin"), id, retry: z.number().int().min(0).max(3).default(0) }),
  /** A script action started (Live Run: "Looking for …"). */
  z.object({ t: z.literal("step-begin"), id, title: text(1000), category: text(40) }),
  z.object({
    t: z.literal("step-end"),
    id,
    title: text(1000),
    category: text(40),
    durationMs: z.number().int().min(0),
    error: text(4000).nullable(),
  }),
  z.object({ t: z.literal("frame"), id, jpeg: text(1_500_000) }),
  z.object({
    t: z.literal("log"),
    id: id.nullable(),
    stream: z.enum(["stdout", "stderr"]),
    text: text(4000),
  }),
  /** Browser console message (FR-8.3 console log). */
  z.object({
    t: z.literal("console"),
    id,
    level: z.enum(["log", "info", "warning", "error", "debug"]),
    text: text(2000),
  }),
  /** A finished page/API request (design: Network tab). Same-origin paths only. */
  z.object({
    t: z.literal("net"),
    id,
    method: text(10),
    url: text(1000),
    status: z.number().int().min(0).max(999).nullable(),
    durationMs: z.number().int().min(0).nullable(),
    failed: z.boolean(),
  }),
  z.object({
    t: z.literal("test-end"),
    id,
    retry: z.number().int().min(0).max(3).default(0),
    status: z.enum(["passed", "failed", "timedOut", "skipped", "interrupted"]),
    durationMs: z.number().int().min(0),
    error: text(8000).nullable(),
  }),
  z.object({
    t: z.literal("artifact"),
    id,
    kind: z.enum(["trace", "screenshot"]),
    seq: z.number().int().min(0).max(1000),
    last: z.boolean(),
    data: text(400_000),
  }),
  z.object({
    t: z.literal("capture"),
    snapshot: domSnapshotSchema,
    screenshot: text(3_000_000).nullable(),
  }),
  z.object({
    t: z.literal("login"),
    ok: z.boolean(),
    storageState: text(5_000_000).nullable(),
    error: text(2000).nullable(),
    screenshot: text(3_000_000).nullable(),
  }),
  z.object({
    t: z.literal("pdf"),
    seq: z.number().int().min(0).max(1000),
    last: z.boolean(),
    data: text(400_000),
  }),
  z.object({ t: z.literal("paused") }),
  z.object({ t: z.literal("resumed") }),
  z.object({ t: z.literal("done"), ok: z.boolean(), error: text(4000).nullable() }),
  z.object({ t: z.literal("exit"), code: z.number().int().nullable() }),
]);
export type RunnerEvent = z.infer<typeof runnerEventSchema>;

/** Parses one output line; anything malformed is dropped (never trusted). */
export function parseEventLine(line: string): RunnerEvent | null {
  if (!line.startsWith("{") || line.length > 4_000_000) return null;
  try {
    const parsed = runnerEventSchema.safeParse(JSON.parse(line));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export const MASK = "••••••";

/** All the forms a secret may take in logs, step titles, traces and form posts. */
export function secretVariants(values: string[]): string[] {
  const out = new Set<string>();
  for (const v of values) {
    if (v.length < 3) continue; // too short to scrub without destroying unrelated text
    out.add(v);
    out.add(encodeURIComponent(v));
    out.add(JSON.stringify(v).slice(1, -1));
    out.add(encodeURIComponent(v).replace(/%20/g, "+"));
  }
  return [...out].sort((a, b) => b.length - a.length);
}

export function scrub(text: string, variants: string[]): string {
  let out = text;
  for (const v of variants) if (out.includes(v)) out = out.split(v).join(MASK);
  return out;
}
