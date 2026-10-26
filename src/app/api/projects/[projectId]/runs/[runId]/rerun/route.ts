import { rerunSchema } from "@/lib/validation";
import { json, readJson, route } from "@/server/http/handler";
import { rerunFailed } from "@/server/services/runs";

type P = { projectId: string; runId: string };

/** Design "Re-run N failed": a new run of this run's failures. */
export const POST = route<P>(async ({ auth, params, req, ip, requestId }) => {
  const { testCaseIds } = await readJson(req, rerunSchema);
  const run = await rerunFailed(auth, params.projectId, params.runId, testCaseIds, {
    ip,
    requestId,
  });
  return json({ run: { id: run.id } }, 201);
});
