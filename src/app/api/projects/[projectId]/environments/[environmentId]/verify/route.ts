import { db } from "@/server/db";
import { json, route } from "@/server/http/handler";
import { JOB_PUBLIC_SELECT } from "@/server/services/ai-jobs";
import { verifyEnvironment } from "@/server/services/environments";

type P = { projectId: string; environmentId: string };

/** FRD step 5: check the environment (sign in once, or open the start page). */
export const POST = route<P>(async ({ auth, params, ip, requestId }) => {
  const job = await verifyEnvironment(auth, params.projectId, params.environmentId, {
    ip,
    requestId,
  });
  return json(
    { job: await db.job.findUniqueOrThrow({ where: { id: job.id }, select: JOB_PUBLIC_SELECT }) },
    202,
  );
});
