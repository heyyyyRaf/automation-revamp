import { requirementUpdateSchema } from "@/lib/validation";
import { json, readJson, route } from "@/server/http/handler";
import { deleteRequirement, updateRequirement } from "@/server/services/requirements";

type P = { projectId: string; requirementId: string };

export const PATCH = route<P>(async ({ auth, params, req, ip, requestId }) => {
  const input = await readJson(req, requirementUpdateSchema);
  const meta = { ip, requestId };
  return json({
    requirement: await updateRequirement(auth, params.projectId, params.requirementId, input, meta),
  });
});

export const DELETE = route<P>(async ({ auth, params, ip, requestId }) => {
  await deleteRequirement(auth, params.projectId, params.requirementId, { ip, requestId });
  return json({ ok: true });
});
