import { generateTestCasesSchema } from "@/lib/validation";
import { db } from "@/server/db";
import { json, readJson, route } from "@/server/http/handler";
import { JOB_PUBLIC_SELECT, startGeneration } from "@/server/services/ai-jobs";

/** Generates DRAFT test cases for the given requirements (default: requirements without any). */
export const POST = route<{ projectId: string }>(async ({ auth, params, req, ip, requestId }) => {
  const { requirementIds } = await readJson(req, generateTestCasesSchema);
  const job = await startGeneration(auth, params.projectId, requirementIds, { ip, requestId });
  return json(
    { job: await db.job.findUniqueOrThrow({ where: { id: job.id }, select: JOB_PUBLIC_SELECT }) },
    202,
  );
});
