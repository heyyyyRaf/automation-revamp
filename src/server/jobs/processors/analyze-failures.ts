import sharp from "sharp";
import { z } from "zod";
import { newBoundary, untrusted } from "@/server/ai/prompt";
import { FAILURE_ANALYSIS_PROMPT } from "@/server/ai/prompts/library";
import { promptRef, systemPrompt } from "@/server/ai/prompts/template";
import { runStructured } from "@/server/ai/run";
import { failureAnalysisSchema } from "@/server/ai/tasks/failures";
import { AIError, type AIContentPart } from "@/server/ai/types";
import { db } from "@/server/db";
import { toJobFailure } from "@/server/jobs/ai-errors";
import { JobFailure, type JobHandler } from "@/server/jobs/runner";
import { loadEnvironmentSecrets } from "@/server/services/environments";
import { getStorage } from "@/server/storage/storage";

const payloadSchema = z.object({ runId: z.string().min(1) });
const MAX_FAILURES = 20;

async function readJson<T>(key: string | null): Promise<T[]> {
  if (!key) return [];
  try {
    const parsed = JSON.parse((await getStorage().get(key)).toString("utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

/**
 * FR-9.3: one probable cause per failed test (app bug, script issue or environment), shown
 * in the report as "Likely cause". Credentials never reach the AI.
 */
export const analyzeFailuresHandler: JobHandler = async ({ job, signal }) => {
  const payload = payloadSchema.safeParse(job.payload);
  if (!payload.success) throw new JobFailure("This job has invalid settings.", false);
  const run = await db.run.findFirst({
    where: { id: payload.data.runId, projectId: job.projectId },
    include: {
      environment: true,
      tests: {
        where: { status: { in: ["FAILED", "ERROR"] } },
        take: MAX_FAILURES,
        include: {
          testCase: true,
          scriptVersion: { select: { code: true } },
          steps: { orderBy: { index: "asc" } },
        },
      },
    },
  });
  if (!run) throw new JobFailure("This run no longer exists.", false);
  if (run.tests.length === 0) return { analysed: 0 };
  const secrets = await loadEnvironmentSecrets(run.environment);
  const forbidden = Object.values(secrets.accounts).flatMap((a) => [a.username, a.password]);

  let analysed = 0;
  for (const [i, t] of run.tests.entries()) {
    if (signal.aborted) break;
    await db.job.update({
      where: { id: job.id },
      data: {
        progress: Math.round((i / run.tests.length) * 100),
        result: { note: `Looking at failure ${i + 1} of ${run.tests.length}` },
      },
    });
    const [consoleLines, network] = await Promise.all([
      readJson<{ level: string; text: string }>(t.consoleKey),
      readJson<{ method: string; url: string; status: number | null; failed: boolean }>(
        t.networkKey,
      ),
    ]);
    const failedStep = t.steps.find((s) => s.error) ?? t.steps.at(-1);
    const steps = (Array.isArray(t.testCase.steps) ? t.testCase.steps : []) as {
      action: string;
      expected?: string | null;
    }[];
    const evidence = [
      `Test case: ${t.testCase.key} ${t.testCase.title}`,
      `Steps:\n${steps.map((s, n) => `${n + 1}. ${s.action}${s.expected ? ` → ${s.expected}` : ""}`).join("\n")}`,
      `Expected result: ${t.testCase.expectedResult}`,
      `Result: ${t.status}${t.attempts > 1 ? ` after ${t.attempts} attempts` : ""}`,
      `Error: ${t.errorMessage ?? "(none)"}`,
      failedStep
        ? `Last or failing step: ${failedStep.title}${failedStep.error ? ` — ${failedStep.error}` : ""}`
        : "",
      `Browser console errors:\n${
        consoleLines
          .filter((c) => c.level === "error")
          .slice(0, 15)
          .map((c) => c.text)
          .join("\n") || "(none)"
      }`,
      `Failed requests:\n${
        network
          .filter((n) => n.failed || (n.status ?? 0) >= 400)
          .slice(0, 15)
          .map((n) => `${n.method} ${n.url} → ${n.failed ? "failed" : n.status}`)
          .join("\n") || "(none)"
      }`,
    ]
      .filter(Boolean)
      .join("\n\n");
    const boundary = newBoundary();
    const content: AIContentPart[] = [
      {
        type: "text",
        text: [
          "Find the likely cause of this failure.",
          untrusted(boundary, "evidence", evidence),
          untrusted(boundary, "script", t.scriptVersion.code.slice(0, 20_000)),
          t.screenshotKey ? "The screenshot taken at the failure follows." : "",
        ].join("\n\n"),
      },
    ];
    if (t.screenshotKey) {
      try {
        const original = await getStorage().get(t.screenshotKey);
        const data = await sharp(original)
          .resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 70 })
          .toBuffer();
        content.push({ type: "image", mimeType: "image/jpeg", data });
      } catch {
        // No screenshot: the text evidence is enough to try.
      }
    }
    try {
      const out = await runStructured(
        { projectId: job.projectId, jobId: job.id },
        {
          purpose: "ANALYZE_FAILURES",
          promptVersion: promptRef(FAILURE_ANALYSIS_PROMPT),
          system: systemPrompt(FAILURE_ANALYSIS_PROMPT, boundary),
          content,
          schema: failureAnalysisSchema,
          schemaName: "failure_analysis",
          maxOutputTokens: 1000,
          signal,
          forbidden,
        },
      );
      await db.runTest.update({
        where: { id: t.id },
        data: { likelyCause: out.cause, causeExplanation: out.explanation },
      });
      analysed++;
    } catch (err) {
      // Budget or configuration problems stop here; one bad answer only skips that failure.
      if (err instanceof AIError && !err.retryable) throw toJobFailure(err);
      if (!(err instanceof AIError)) throw err;
    }
  }
  return { analysed, failures: run.tests.length };
};
