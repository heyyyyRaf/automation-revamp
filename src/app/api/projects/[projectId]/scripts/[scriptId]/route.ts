import { json, route } from "@/server/http/handler";
import { getScript } from "@/server/services/scripts";

type P = { projectId: string; scriptId: string };

export const GET = route<P>(async ({ auth, params }) =>
  json({ script: await getScript(auth, params.projectId, params.scriptId) }),
);
