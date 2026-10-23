import { flowCreateSchema } from "@/lib/validation";
import { json, readJson, route } from "@/server/http/handler";
import { createFlow, listFlows } from "@/server/services/requirements";

type P = { projectId: string };

export const GET = route<P>(async ({ auth, params }) =>
  json({ flows: await listFlows(auth, params.projectId) }),
);

export const POST = route<P>(async ({ auth, params, req, ip, requestId }) => {
  const input = await readJson(req, flowCreateSchema);
  return json({ flow: await createFlow(auth, params.projectId, input, { ip, requestId }) }, 201);
});
