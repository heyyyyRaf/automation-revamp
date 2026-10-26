import { environmentUpdateSchema } from "@/lib/validation";
import { json, readJson, route } from "@/server/http/handler";
import { deleteEnvironment, updateEnvironment } from "@/server/services/environments";

type P = { environmentId: string };
const SHARED = { shared: true } as const;

export const PATCH = route<P>(async ({ auth, params, req, ip, requestId }) => {
  const input = await readJson(req, environmentUpdateSchema);
  await updateEnvironment(auth, SHARED, params.environmentId, input, { ip, requestId });
  return json({ ok: true });
});

export const DELETE = route<P>(async ({ auth, params, ip, requestId }) => {
  await deleteEnvironment(auth, SHARED, params.environmentId, { ip, requestId });
  return json({ ok: true });
});
