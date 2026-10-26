import { environmentCreateSchema } from "@/lib/validation";
import { json, readJson, route } from "@/server/http/handler";
import { createEnvironment, listEnvironments } from "@/server/services/environments";

type P = { projectId: string };

/** The project's environments plus the shared ones. */
export const GET = route<P>(async ({ auth, params }) =>
  json({ environments: await listEnvironments(auth, params.projectId) }),
);

export const POST = route<P>(async ({ auth, params, req, ip, requestId }) => {
  const input = await readJson(req, environmentCreateSchema);
  const environment = await createEnvironment(auth, { projectId: params.projectId }, input, {
    ip,
    requestId,
  });
  return json({ environment: { id: environment.id } }, 201);
});
