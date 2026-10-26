import { runControlSchema } from "@/lib/validation";
import { json, readJson, route } from "@/server/http/handler";
import { controlRun } from "@/server/services/runs";

type P = { projectId: string; runId: string };

/** Pause, resume, slow motion and stop (design: Live run). */
export const POST = route<P>(async ({ auth, params, req, ip, requestId }) => {
  const input = await readJson(req, runControlSchema);
  await controlRun(auth, params.projectId, params.runId, input, { ip, requestId });
  return json({ ok: true });
});
