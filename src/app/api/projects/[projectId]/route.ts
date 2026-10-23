import { updateProjectSchema } from "@/lib/validation";
import { json, readJson, route } from "@/server/http/handler";
import { getProject, updateProject } from "@/server/services/projects";

type P = { projectId: string };

export const GET = route<P>(async ({ auth, params }) =>
  json({ project: await getProject(auth, params.projectId) }),
);

export const PATCH = route<P>(async ({ auth, req, params, ip, requestId }) => {
  const input = await readJson(req, updateProjectSchema);
  return json({ project: await updateProject(auth, params.projectId, input, { ip, requestId }) });
});
