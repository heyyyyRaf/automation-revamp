import { scriptGenerateSchema } from "@/lib/validation";
import { db } from "@/server/db";
import { json, readJson, route } from "@/server/http/handler";
import { JOB_PUBLIC_SELECT } from "@/server/services/ai-jobs";
import { generateScripts, listScripts } from "@/server/services/scripts";

type P = { projectId: string };

export const GET = route<P>(async ({ auth, params }) =>
  json({ scripts: await listScripts(auth, params.projectId) }),
);

/** FR-6.1: write scripts for approved, automatable cases. */
export const POST = route<P>(async ({ auth, params, req, ip, requestId }) => {
  const input = await readJson(req, scriptGenerateSchema);
  const job = await generateScripts(auth, params.projectId, input, { ip, requestId });
  return json(
    { job: await db.job.findUniqueOrThrow({ where: { id: job.id }, select: JOB_PUBLIC_SELECT }) },
    202,
  );
});
