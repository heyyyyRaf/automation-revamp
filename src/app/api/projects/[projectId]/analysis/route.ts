import { analysisRetrySchema } from "@/lib/validation";
import { db } from "@/server/db";
import { json, readJson, route } from "@/server/http/handler";
import {
  JOB_PUBLIC_SELECT,
  retryFailedAnalysisParts,
  startAnalysis,
} from "@/server/services/ai-jobs";

/**
 * Starts AI requirement analysis of all uploaded material (adds new items only).
 * With { retryJobId }, re-runs only the parts of that analysis that failed (NFR-6).
 */
export const POST = route<{ projectId: string }>(async ({ auth, req, params, ip, requestId }) => {
  const meta = { ip, requestId };
  const input = await readJson(req, analysisRetrySchema); // an empty body is {}
  const job = input.retryJobId
    ? await retryFailedAnalysisParts(auth, params.projectId, input.retryJobId, meta)
    : await startAnalysis(auth, params.projectId, meta);
  return json(
    { job: await db.job.findUniqueOrThrow({ where: { id: job.id }, select: JOB_PUBLIC_SELECT }) },
    202,
  );
});
