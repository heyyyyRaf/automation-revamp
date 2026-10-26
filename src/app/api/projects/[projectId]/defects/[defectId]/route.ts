import { defectUpdateSchema } from "@/lib/validation";
import { json, readJson, route } from "@/server/http/handler";
import { updateDefect } from "@/server/services/defects";

type P = { projectId: string; defectId: string };

export const PATCH = route<P>(async ({ auth, params, req, ip, requestId }) => {
  const input = await readJson(req, defectUpdateSchema);
  const defect = await updateDefect(auth, params.projectId, params.defectId, input, {
    ip,
    requestId,
  });
  return json({ defect });
});
