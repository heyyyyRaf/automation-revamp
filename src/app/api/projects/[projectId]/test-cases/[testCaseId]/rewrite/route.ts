import { applyRewriteSchema, testCaseRewriteSchema } from "@/lib/validation";
import { db } from "@/server/db";
import { json, readJson, route } from "@/server/http/handler";
import { applyRewrite, JOB_PUBLIC_SELECT, requestRewrite } from "@/server/services/ai-jobs";

type P = { projectId: string; testCaseId: string };

/** Ask the AI to rewrite this case with an instruction. Returns the job; its result is a proposal. */
export const POST = route<P>(async ({ auth, params, req, ip, requestId }) => {
  const { instruction } = await readJson(req, testCaseRewriteSchema);
  const job = await requestRewrite(auth, params.projectId, params.testCaseId, instruction, {
    ip,
    requestId,
  });
  return json(
    { job: await db.job.findUniqueOrThrow({ where: { id: job.id }, select: JOB_PUBLIC_SELECT }) },
    202,
  );
});

/** Accept the proposal from a finished rewrite job. */
export const PUT = route<P>(async ({ auth, params, req, ip, requestId }) => {
  const { jobId } = await readJson(req, applyRewriteSchema);
  const testCase = await applyRewrite(auth, params.projectId, params.testCaseId, jobId, {
    ip,
    requestId,
  });
  return json({ testCase });
});
