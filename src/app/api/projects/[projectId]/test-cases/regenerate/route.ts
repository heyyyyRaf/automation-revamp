import { regenerateSchema } from "@/lib/validation";
import { db } from "@/server/db";
import { json, readJson, route } from "@/server/http/handler";
import { JOB_PUBLIC_SELECT, regenerateRejected } from "@/server/services/ai-jobs";

/** FR-4.5: replace rejected test cases (all, or the chosen ones) with new drafts. */
export const POST = route<{ projectId: string }>(async ({ auth, params, req, ip, requestId }) => {
  const { testCaseIds } = await readJson(req, regenerateSchema);
  const job = await regenerateRejected(auth, params.projectId, testCaseIds, { ip, requestId });
  return json(
    { job: await db.job.findUniqueOrThrow({ where: { id: job.id }, select: JOB_PUBLIC_SELECT }) },
    202,
  );
});
