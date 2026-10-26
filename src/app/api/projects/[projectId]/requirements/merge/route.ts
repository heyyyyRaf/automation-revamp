import { requirementMergeSchema } from "@/lib/validation";
import { json, readJson, route } from "@/server/http/handler";
import { mergeRequirements } from "@/server/services/requirements";

/** FR-3.4: merge duplicate requirements into one. */
export const POST = route<{ projectId: string }>(async ({ auth, params, req, ip, requestId }) => {
  const input = await readJson(req, requirementMergeSchema);
  const requirement = await mergeRequirements(auth, params.projectId, input, { ip, requestId });
  return json({ requirement });
});
