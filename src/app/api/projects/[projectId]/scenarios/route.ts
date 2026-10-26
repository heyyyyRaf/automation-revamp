import { scenarioCreateSchema } from "@/lib/validation";
import { json, readJson, route } from "@/server/http/handler";
import { createScenario, listScenarios } from "@/server/services/scenarios";

type P = { projectId: string };

export const GET = route<P>(async ({ auth, params }) =>
  json({ scenarios: await listScenarios(auth, params.projectId) }),
);

export const POST = route<P>(async ({ auth, params, req, ip, requestId }) => {
  const input = await readJson(req, scenarioCreateSchema);
  const scenario = await createScenario(auth, params.projectId, input, { ip, requestId });
  return json({ scenario }, 201);
});
