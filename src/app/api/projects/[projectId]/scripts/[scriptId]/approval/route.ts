import { scriptApproveSchema } from "@/lib/validation";
import { json, readJson, route } from "@/server/http/handler";
import { decideScript } from "@/server/services/scripts";

type P = { projectId: string; scriptId: string };

/** The approval gate: only approved versions ever run. */
export const POST = route<P>(async ({ auth, params, req, ip, requestId }) => {
  const input = await readJson(req, scriptApproveSchema);
  await decideScript(auth, params.projectId, params.scriptId, input, { ip, requestId });
  return json({ ok: true });
});
