import { runCreateSchema } from "@/lib/validation";
import { json, readJson, route } from "@/server/http/handler";
import { listRuns, startRun } from "@/server/services/runs";

type P = { projectId: string };

export const GET = route<P>(async ({ auth, params }) =>
  json({ runs: await listRuns(auth, params.projectId) }),
);

/** FR-8.1: run the selected approved scripts on a verified environment. */
export const POST = route<P>(async ({ auth, params, req, ip, requestId }) => {
  const input = await readJson(req, runCreateSchema);
  const run = await startRun(auth, params.projectId, input, { ip, requestId });
  return json({ run: { id: run.id, status: run.status } }, 201);
});
