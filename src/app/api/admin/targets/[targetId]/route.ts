import { json, route } from "@/server/http/handler";
import { revokeGlobalTarget } from "@/server/services/targets";

export const DELETE = route<{ targetId: string }>(async ({ auth, params, ip, requestId }) => {
  await revokeGlobalTarget(auth, params.targetId, { ip, requestId });
  return json({ ok: true });
});
