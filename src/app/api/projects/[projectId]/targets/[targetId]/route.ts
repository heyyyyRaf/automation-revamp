import { targetDecisionSchema } from "@/lib/validation";
import { json, readJson, route } from "@/server/http/handler";
import { decideTarget } from "@/server/services/targets";

type P = { projectId: string; targetId: string };

/** Lead only: approve (deciding on private networks) or revoke. */
export const PATCH = route<P>(async ({ auth, params, req, ip, requestId }) => {
  const input = await readJson(req, targetDecisionSchema);
  const target = await decideTarget(auth, params.projectId, params.targetId, input, {
    ip,
    requestId,
  });
  return json({ target });
});
