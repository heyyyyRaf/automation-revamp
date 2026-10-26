import { scriptVersionCreateSchema } from "@/lib/validation";
import { json, readJson, route } from "@/server/http/handler";
import { saveScriptEdit } from "@/server/services/scripts";

type P = { projectId: string; scriptId: string };

/** FR-6.3: save the tester's edit as a new, checked version. */
export const POST = route<P>(async ({ auth, params, req, ip, requestId }) => {
  const { code } = await readJson(req, scriptVersionCreateSchema);
  const version = await saveScriptEdit(auth, params.projectId, params.scriptId, code, {
    ip,
    requestId,
  });
  return json({ version: { id: version.id, version: version.version } }, 201);
});
