import { globalTargetSchema } from "@/lib/validation";
import { json, readJson, route } from "@/server/http/handler";
import { addGlobalTarget, listGlobalTargets, listPendingTargets } from "@/server/services/targets";

/** Lead: addresses waiting for approval (all projects) and the global allowlist. */
export const GET = route(async ({ auth }) =>
  json({ pending: await listPendingTargets(auth), global: await listGlobalTargets(auth) }),
);

export const POST = route(async ({ auth, req, ip, requestId }) => {
  const input = await readJson(req, globalTargetSchema);
  const target = await addGlobalTarget(auth, input, { ip, requestId });
  return json({ target }, 201);
});
