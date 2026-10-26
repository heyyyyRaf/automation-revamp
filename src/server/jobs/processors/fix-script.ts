import { z } from "zod";
import { db } from "@/server/db";
import { toJobFailure } from "@/server/jobs/ai-errors";
import { JobFailure, type JobHandler } from "@/server/jobs/runner";
import {
  aiFix,
  compiles,
  contextFor,
  loadPages,
  problemsOf,
  runChecks,
  saveVersion,
  storedChecks,
} from "@/server/scripts/pipeline";
import { loadEnvironmentSecrets } from "@/server/services/environments";

const payloadSchema = z.object({
  scriptId: z.string().min(1),
  instruction: z.string().max(2000).nullable().default(null),
  /** A failed run of this script: its error is given to the AI as a problem to fix. */
  runTestId: z.string().nullable().default(null),
});

/**
 * Design "Ask AI to fix": the AI corrects the latest version (compile errors, missing
 * selectors, a failed run, or the tester's instruction). The result is a NEW version that
 * the tester reviews and approves like any other — nothing changes silently.
 */
export const fixScriptHandler: JobHandler = async ({ job, signal }) => {
  const payload = payloadSchema.safeParse(job.payload);
  if (!payload.success) throw new JobFailure("This job has invalid settings.", false);
  const script = await db.script.findFirst({
    where: { id: payload.data.scriptId, projectId: job.projectId },
    include: {
      testCase: true,
      versions: { orderBy: { version: "desc" }, take: 1 },
    },
  });
  const latest = script?.versions[0];
  if (!script || !latest) throw new JobFailure("This script no longer exists.", false);
  const env = script.environmentId
    ? await db.environment.findFirst({
        where: {
          id: script.environmentId,
          OR: [{ projectId: job.projectId }, { projectId: null }],
        },
      })
    : null;
  if (!env) throw new JobFailure("The script's environment no longer exists.", false);

  const secrets = await loadEnvironmentSecrets(env);
  const pages = await loadPages(latest.domSnapshotId);
  const ctx = contextFor(script.testCase, script.startPath, secrets, pages);
  const problems = problemsOf(storedChecks(latest));
  if (payload.data.runTestId) {
    const rt = await db.runTest.findFirst({
      where: { id: payload.data.runTestId, run: { projectId: job.projectId } },
      select: { errorMessage: true },
    });
    if (rt?.errorMessage)
      problems.unshift(`The last run failed: ${rt.errorMessage.slice(0, 1500)}`);
  }

  let out;
  try {
    out = await aiFix(
      job.projectId,
      job.id,
      ctx,
      latest.code,
      problems,
      payload.data.instruction,
      secrets,
      signal,
    );
  } catch (err) {
    throw toJobFailure(err);
  }
  const checks = runChecks(out.code, pages);
  const version = await saveVersion({
    scriptId: script.id,
    code: out.code,
    source: "AI_FIX",
    checks,
    notes: out.notes,
    domSnapshotId: latest.domSnapshotId,
    createdById: job.createdById,
    needsEdit: !compiles(checks),
  });
  return { versionId: version.id, version: version.version, compiles: compiles(checks) };
};
