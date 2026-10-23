import { flowUpdateSchema } from "@/lib/validation";
import { json, readJson, route } from "@/server/http/handler";
import { deleteFlow, updateFlow } from "@/server/services/requirements";

type P = { projectId: string; flowId: string };

export const PATCH = route<P>(async ({ auth, params, req, ip, requestId }) => {
  const input = await readJson(req, flowUpdateSchema);
  return json({
    flow: await updateFlow(auth, params.projectId, params.flowId, input, { ip, requestId }),
  });
});

export const DELETE = route<P>(async ({ auth, params, ip, requestId }) => {
  await deleteFlow(auth, params.projectId, params.flowId, { ip, requestId });
  return json({ ok: true });
});
