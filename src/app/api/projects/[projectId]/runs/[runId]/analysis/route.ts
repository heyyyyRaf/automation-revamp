import { json, route } from "@/server/http/handler";
import { requestFailureAnalysis } from "@/server/services/reports";

type P = { projectId: string; runId: string };

/** FR-9.3: look for the likely cause of each failure again. */
export const POST = route<P>(async ({ auth, params, ip, requestId }) => {
  const job = await requestFailureAnalysis(auth, params.projectId, params.runId, { ip, requestId });
  return json({ job: { id: job.id, status: job.status } }, 202);
});
