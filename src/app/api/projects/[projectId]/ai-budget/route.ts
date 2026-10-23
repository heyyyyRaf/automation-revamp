import { aiBudgetSchema } from "@/lib/validation";
import { json, readJson, route } from "@/server/http/handler";
import { aiBudget } from "@/server/services/ai-jobs";
import { setAiBudget } from "@/server/services/projects";

type P = { projectId: string };

export const GET = route<P>(async ({ auth, params }) =>
  json({ budget: await aiBudget(auth, params.projectId) }),
);

/** Admin only: set the project's monthly token cap (null = use the default). */
export const PATCH = route<P>(async ({ auth, params, req, ip, requestId }) => {
  const { monthlyTokenCap } = await readJson(req, aiBudgetSchema);
  await setAiBudget(auth, params.projectId, monthlyTokenCap, { ip, requestId });
  return json({ budget: await aiBudget(auth, params.projectId) });
});
