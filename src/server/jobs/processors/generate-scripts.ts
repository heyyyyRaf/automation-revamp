import { z } from "zod";
import { AIError } from "@/server/ai/types";
import { db } from "@/server/db";
import { toJobFailure } from "@/server/jobs/ai-errors";
import { JobFailure, type JobHandler } from "@/server/jobs/runner";
import {
  aiFix,
  aiGenerate,
  capturePages,
  compiles,
  contextFor,
  flowPaths,
  MAX_CAPTURE_PAGES,
  problemsOf,
  runChecks,
  saveVersion,
} from "@/server/scripts/pipeline";
import { loadEnvironmentSecrets } from "@/server/services/environments";

const payloadSchema = z.object({
  testCaseIds: z.array(z.string()).min(1).max(200),
  environmentId: z.string().min(1),
  startPath: z.string().startsWith("/").max(500).default("/"),
});

const APPROVED_LIKE = ["APPROVED", "SCRIPTED", "PASSED", "FAILED", "ERROR"] as const;

/**
 * FRD step 4 (FR-6.1/6.2): opens the target, captures each page of the flow, and writes a
 * Playwright script per approved, automatable case using the real selectors. Each script is
 * type-checked before saving; a compile error gets one regeneration, then the script is
 * marked "Script needs edit".
 */
export const generateScriptsHandler: JobHandler = async ({ job, signal }) => {
  const payload = payloadSchema.safeParse(job.payload);
  if (!payload.success) throw new JobFailure("This job has invalid settings.", false);
  const { testCaseIds, environmentId, startPath } = payload.data;
  const projectId = job.projectId;

  const env = await db.environment.findFirst({
    where: { id: environmentId, OR: [{ projectId }, { projectId: null }] },
  });
  if (!env) throw new JobFailure("The environment no longer exists.", false);
  const cases = await db.testCase.findMany({
    where: {
      id: { in: testCaseIds },
      projectId,
      deletedAt: null,
      automatable: true,
      status: { in: [...APPROVED_LIKE] },
    },
    orderBy: { key: "asc" },
  });
  if (cases.length === 0) {
    throw new JobFailure("None of the chosen test cases is approved and automatable.", false);
  }

  const secrets = await loadEnvironmentSecrets(env);
  const paths: string[] = [];
  for (const tc of cases) {
    for (const p of flowPaths(startPath, (tc.steps as { action: string }[] | null) ?? [])) {
      if (!paths.includes(p) && paths.length < MAX_CAPTURE_PAGES) paths.push(p);
    }
  }
  await note(job.id, `Opening ${paths.length} page${paths.length > 1 ? "s" : ""} of the app`, 5);
  const { snapshotId, pages } = await capturePages(env, secrets, paths, job.id, signal);

  let generated = 0;
  let needsEdit = 0;
  const failed: { key: string; error: string }[] = [];
  for (const [i, tc] of cases.entries()) {
    if (signal.aborted) throw new JobFailure("Script generation was stopped.", false);
    await note(
      job.id,
      `Writing script ${i + 1} of ${cases.length}`,
      10 + Math.round((i / cases.length) * 85),
    );
    const script = await db.script.upsert({
      where: { testCaseId: tc.id },
      create: { projectId, testCaseId: tc.id, startPath, environmentId: env.id },
      update: { startPath, environmentId: env.id },
    });
    const ctx = contextFor(tc, startPath, secrets, pages);
    try {
      let out = await aiGenerate(projectId, job.id, ctx, secrets, signal);
      let checks = runChecks(out.code, pages);
      if (!compiles(checks)) {
        // FRD: compile error → regenerate once.
        out = await aiFix(
          projectId,
          job.id,
          ctx,
          out.code,
          problemsOf(checks),
          null,
          secrets,
          signal,
        );
        checks = runChecks(out.code, pages);
      }
      const bad = !compiles(checks);
      await saveVersion({
        scriptId: script.id,
        code: out.code,
        source: "AI_GENERATED",
        checks,
        notes: out.notes,
        domSnapshotId: snapshotId,
        createdById: job.createdById,
        needsEdit: bad,
      });
      generated++;
      if (bad) needsEdit++;
    } catch (err) {
      // Budget or configuration problems stop the whole job; other AI errors skip this case.
      if (err instanceof AIError && !err.retryable) throw toJobFailure(err);
      if (!(err instanceof AIError)) throw err;
      failed.push({ key: tc.key, error: err.userMessage });
    }
  }
  if (generated === 0) {
    throw new JobFailure(failed[0]?.error ?? "No script could be written.", false);
  }
  return { generated, needsEdit, pagesCaptured: pages.length, failed };
};

async function note(jobId: string, text: string, progress: number) {
  await db.job.update({ where: { id: jobId }, data: { progress, result: { note: text } } });
}
