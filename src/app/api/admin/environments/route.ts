import { environmentCreateSchema } from "@/lib/validation";
import { json, readJson, route } from "@/server/http/handler";
import { createEnvironment, listSharedEnvironments } from "@/server/services/environments";

const SHARED = { shared: true } as const;

/** Shared environments: created by the Lead, usable by every project. */
export const GET = route(async ({ auth }) =>
  json({ environments: await listSharedEnvironments(auth) }),
);

export const POST = route(async ({ auth, req, ip, requestId }) => {
  const input = await readJson(req, environmentCreateSchema);
  const environment = await createEnvironment(auth, SHARED, input, { ip, requestId });
  return json({ environment: { id: environment.id } }, 201);
});
