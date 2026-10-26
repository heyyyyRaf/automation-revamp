import { targetRequestSchema } from "@/lib/validation";
import { json, readJson, route } from "@/server/http/handler";
import { listTargets, requestTarget } from "@/server/services/targets";

type P = { projectId: string };

export const GET = route<P>(async ({ auth, params }) =>
  json({ targets: await listTargets(auth, params.projectId) }),
);

/** Ask the Lead to approve an address (NFR-3: runs only hit approved URLs). */
export const POST = route<P>(async ({ auth, params, req, ip, requestId }) => {
  const input = await readJson(req, targetRequestSchema);
  const target = await requestTarget(auth, params.projectId, input, { ip, requestId });
  return json({ target }, 201);
});
