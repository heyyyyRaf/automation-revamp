import { z } from "zod";
import type { Environment, Prisma, ScriptSource, TestCase } from "@/generated/prisma/client";
import { newBoundary } from "@/server/ai/prompt";
import { SCRIPT_FIX_PROMPT, SCRIPT_PROMPT } from "@/server/ai/prompts/library";
import { promptRef, systemPrompt } from "@/server/ai/prompts/template";
import { runStructured } from "@/server/ai/run";
import {
  fixContent,
  mergeSnapshots,
  scriptContent,
  scriptOutputSchema,
  type ScriptContext,
  type ScriptOutput,
} from "@/server/ai/tasks/scripts";
import { db } from "@/server/db";
import { JobFailure } from "@/server/jobs/runner";
import { domSnapshotSchema, type DomSnapshotData } from "@/server/sandbox/protocol";
import { runInSandbox } from "@/server/sandbox/sandbox";
import { checkScript, checksToColumns, type ScriptChecks } from "@/server/scripts/validate";
import { grantedOrigins, type EnvironmentSecrets } from "@/server/services/environments";
import { getStorage, newObjectKey } from "@/server/storage/storage";

export const MAX_CAPTURE_PAGES = 5;

/**
 * Pages to capture for a case: the start page plus app paths its steps mention
 * ("Open /leave/new"), up to five (FRD step 4: "each page in the flow").
 */
export function flowPaths(startPath: string, steps: { action: string }[]): string[] {
  const out = [startPath];
  for (const s of steps) {
    for (const m of s.action.matchAll(/(?:^|[\s"'(`])(\/[a-z0-9][a-z0-9\-_/]*)/gi)) {
      const path = (m[1] ?? "").replace(/[/.]+$/, "") || "/";
      if (!out.includes(path)) out.push(path);
      if (out.length >= MAX_CAPTURE_PAGES) return out;
    }
  }
  return out;
}

const storedPagesSchema = z.object({ pages: z.array(domSnapshotSchema).max(MAX_CAPTURE_PAGES) });

/**
 * Opens the target in the sandbox and captures each page's accessibility tree and
 * interactive elements. FRD error path: page not reachable or login fails → stop with the
 * reason. Returns the stored snapshot (one row holding every captured page).
 */
export async function capturePages(
  env: Environment,
  secrets: EnvironmentSecrets,
  paths: string[],
  jobId: string,
  signal: AbortSignal,
): Promise<{ snapshotId: string; pages: DomSnapshotData[] }> {
  let origins;
  try {
    origins = await grantedOrigins(env);
  } catch (err) {
    throw new JobFailure(
      err instanceof Error ? err.message : "The address is not approved.",
      false,
    );
  }
  const pages: DomSnapshotData[] = [];
  let error: string | null = null;
  for await (const event of runInSandbox({
    sessionId: `capture-${jobId}`,
    label: `capture:${env.id}`,
    origins,
    input: {
      mode: "capture",
      baseURL: env.baseUrl,
      storageState: secrets.storageState,
      accounts: secrets.accounts,
      vars: secrets.vars,
      testTimeoutMs: 60_000,
      retries: 0,
      slowMoMs: 0,
      tests: [],
      capture: { paths: paths.slice(0, MAX_CAPTURE_PAGES) },
    },
    timeoutMs: 180_000,
    signal,
  })) {
    if (event.t === "capture") pages.push(event.snapshot);
    else if (event.t === "done" && !event.ok) error = event.error;
  }
  if (pages.length === 0) {
    throw new JobFailure(
      `The app could not be opened in the browser: ${error ?? "no response"}. Check the environment and try again.`,
      false,
    );
  }
  const storageKey = newObjectKey(env.projectId ?? "shared", "artifacts");
  await getStorage().put(
    storageKey,
    Buffer.from(JSON.stringify({ pages }), "utf8"),
    "application/json",
  );
  const snapshot = await db.domSnapshot.create({
    data: { environmentId: env.id, url: pages[0]?.url ?? env.baseUrl, storageKey },
  });
  return { snapshotId: snapshot.id, pages };
}

export async function loadPages(snapshotId: string | null): Promise<DomSnapshotData[]> {
  if (!snapshotId) return [];
  const row = await db.domSnapshot.findUnique({ where: { id: snapshotId } });
  if (!row) return [];
  const blob = await getStorage()
    .get(row.storageKey)
    .catch(() => null);
  if (!blob) return [];
  const parsed = storedPagesSchema.safeParse(JSON.parse(blob.toString("utf8")));
  return parsed.success ? parsed.data.pages : [];
}

export function contextFor(
  tc: Pick<TestCase, "key" | "title" | "preconditions" | "steps" | "testData" | "expectedResult">,
  startPath: string,
  secrets: EnvironmentSecrets,
  pages: DomSnapshotData[],
): ScriptContext {
  return {
    testCase: {
      key: tc.key,
      title: tc.title,
      preconditions: tc.preconditions,
      steps: (Array.isArray(tc.steps) ? tc.steps : []) as {
        action: string;
        expected?: string | null;
      }[],
      testData: (tc.testData as Record<string, string> | null) ?? {},
      expectedResult: tc.expectedResult,
    },
    startPath,
    accountLabels: Object.keys(secrets.accounts),
    variableNames: Object.keys(secrets.vars),
    pages,
  };
}

/** The values the AI must never see: every credential of the environment. */
function forbiddenValues(secrets: EnvironmentSecrets): string[] {
  return Object.values(secrets.accounts).flatMap((a) => [a.username, a.password]);
}

export function aiGenerate(
  projectId: string,
  jobId: string,
  ctx: ScriptContext,
  secrets: EnvironmentSecrets,
  signal: AbortSignal,
): Promise<ScriptOutput> {
  const boundary = newBoundary();
  return runStructured(
    { projectId, jobId },
    {
      purpose: "GENERATE_SCRIPT",
      promptVersion: promptRef(SCRIPT_PROMPT),
      system: systemPrompt(SCRIPT_PROMPT, boundary),
      content: [{ type: "text", text: scriptContent(boundary, ctx) }],
      schema: scriptOutputSchema,
      schemaName: "script_generation",
      maxOutputTokens: 12_000,
      signal,
      forbidden: forbiddenValues(secrets),
    },
  );
}

export function aiFix(
  projectId: string,
  jobId: string,
  ctx: ScriptContext,
  code: string,
  problems: string[],
  instruction: string | null,
  secrets: EnvironmentSecrets,
  signal: AbortSignal,
): Promise<ScriptOutput> {
  const boundary = newBoundary();
  return runStructured(
    { projectId, jobId },
    {
      purpose: "FIX_SCRIPT",
      promptVersion: promptRef(SCRIPT_FIX_PROMPT),
      system: systemPrompt(SCRIPT_FIX_PROMPT, boundary),
      content: [{ type: "text", text: fixContent(boundary, ctx, code, problems, instruction) }],
      schema: scriptOutputSchema,
      schemaName: "script_fix",
      maxOutputTokens: 12_000,
      signal,
      forbidden: forbiddenValues(secrets),
    },
  );
}

/** What is wrong with a version, in words the fix prompt (and the tester) can act on. */
export function problemsOf(checks: ScriptChecks): string[] {
  return [
    ...checks.typeCheckLog.map((d) => `Line ${d.line}: ${d.message}`),
    ...checks.safetyIssues.map((i) => `Line ${i.line}: ${i.message}`),
    ...checks.selectorCheck
      .filter((s) => s.status === "missing")
      .map((s) => `Line ${s.line}: ${s.selector} is not on the captured pages.`),
  ].slice(0, 30);
}

export const compiles = (c: ScriptChecks) => c.typeCheckOk && c.safetyCheckOk;

/** The check results stored on a version (JSON columns) as typed values. */
export function storedChecks(v: {
  typeCheckOk: boolean;
  typeCheckLog: unknown;
  safetyCheckOk: boolean;
  safetyIssues: unknown;
  selectorCheck: unknown;
}): ScriptChecks {
  const list = <T>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);
  return {
    typeCheckOk: v.typeCheckOk,
    typeCheckLog: list(v.typeCheckLog),
    safetyCheckOk: v.safetyCheckOk,
    safetyIssues: list(v.safetyIssues),
    selectorCheck: list(v.selectorCheck),
  };
}

export function runChecks(code: string, pages: DomSnapshotData[]): ScriptChecks {
  return checkScript(code, mergeSnapshots(pages));
}

/**
 * Saves an immutable version. Any new version withdraws the script's approval: the edited
 * script is the one that runs (FR-6.3), so it must be approved again.
 */
export async function saveVersion(input: {
  scriptId: string;
  code: string;
  source: ScriptSource;
  checks: ScriptChecks;
  notes: string | null;
  domSnapshotId: string | null;
  createdById: string | null;
  needsEdit: boolean;
}) {
  return db.$transaction(async (tx) => {
    const last = await tx.scriptVersion.findFirst({
      where: { scriptId: input.scriptId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const version = await tx.scriptVersion.create({
      data: {
        scriptId: input.scriptId,
        version: (last?.version ?? 0) + 1,
        code: input.code,
        source: input.source,
        domSnapshotId: input.domSnapshotId,
        notes: input.notes,
        createdById: input.createdById,
        ...checksToColumns(input.checks),
      },
    });
    const script = await tx.script.update({
      where: { id: input.scriptId },
      data: {
        status: "DRAFT",
        approvedVersionId: null,
        approvedById: null,
        approvedAt: null,
        needsEdit: input.needsEdit,
      },
      select: { testCaseId: true },
    });
    // The case is no longer Scripted until a version is approved again.
    await tx.testCase.updateMany({
      where: { id: script.testCaseId, status: "SCRIPTED" },
      data: { status: "APPROVED" },
    });
    return version;
  });
}

/** When a test case is edited, its script approval no longer applies (it must be re-approved). */
export async function withdrawScriptApproval(
  tx: Prisma.TransactionClient,
  testCaseId: string,
): Promise<boolean> {
  const { count } = await tx.script.updateMany({
    where: { testCaseId, approvedVersionId: { not: null } },
    data: { status: "DRAFT", approvedVersionId: null, approvedById: null, approvedAt: null },
  });
  return count > 0;
}
