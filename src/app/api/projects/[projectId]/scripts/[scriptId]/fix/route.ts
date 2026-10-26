import { scriptFixSchema } from "@/lib/validation";
import { db } from "@/server/db";
import { json, readJson, route } from "@/server/http/handler";
import { JOB_PUBLIC_SELECT } from "@/server/services/ai-jobs";
import { requestScriptFix } from "@/server/services/scripts";

type P = { projectId: string; scriptId: string };

/** Design "Ask AI to fix": the result is a new version to review. */
export const POST = route<P>(async ({ auth, params, req, ip, requestId }) => {
  const input = await readJson(req, scriptFixSchema);
  const job = await requestScriptFix(auth, params.projectId, params.scriptId, input, {
    ip,
    requestId,
  });
  return json(
    { job: await db.job.findUniqueOrThrow({ where: { id: job.id }, select: JOB_PUBLIC_SELECT }) },
    202,
  );
});
