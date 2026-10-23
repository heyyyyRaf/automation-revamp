import { requirementCreateSchema } from "@/lib/validation";
import { json, readJson, route } from "@/server/http/handler";
import { createRequirement, listRequirements } from "@/server/services/requirements";

type P = { projectId: string };

export const GET = route<P>(async ({ auth, params }) =>
  json({ requirements: await listRequirements(auth, params.projectId) }),
);

export const POST = route<P>(async ({ auth, params, req, ip, requestId }) => {
  const input = await readJson(req, requirementCreateSchema);
  const requirement = await createRequirement(auth, params.projectId, input, { ip, requestId });
  return json({ requirement }, 201);
});
