import { scenarioUpdateSchema } from "@/lib/validation";
import { json, readJson, route } from "@/server/http/handler";
import { deleteScenario, updateScenario } from "@/server/services/scenarios";

type P = { projectId: string; scenarioId: string };

export const PATCH = route<P>(async ({ auth, params, req, ip, requestId }) => {
  const input = await readJson(req, scenarioUpdateSchema);
  const scenario = await updateScenario(auth, params.projectId, params.scenarioId, input, {
    ip,
    requestId,
  });
  return json({ scenario });
});

export const DELETE = route<P>(async ({ auth, params, ip, requestId }) => {
  await deleteScenario(auth, params.projectId, params.scenarioId, { ip, requestId });
  return json({ ok: true });
});
