import { db } from "@/server/db";
import { json, route } from "@/server/http/handler";
import { JOB_PUBLIC_SELECT, startAnalysis } from "@/server/services/ai-jobs";

/** Starts AI requirement analysis of all uploaded material (adds new items only). */
export const POST = route<{ projectId: string }>(async ({ auth, params, ip, requestId }) => {
  const job = await startAnalysis(auth, params.projectId, { ip, requestId });
  return json(
    { job: await db.job.findUniqueOrThrow({ where: { id: job.id }, select: JOB_PUBLIC_SELECT }) },
    202,
  );
});
