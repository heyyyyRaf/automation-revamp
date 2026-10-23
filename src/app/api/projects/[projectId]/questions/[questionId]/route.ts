import { questionUpdateSchema } from "@/lib/validation";
import { json, readJson, route } from "@/server/http/handler";
import { updateQuestion } from "@/server/services/requirements";

type P = { projectId: string; questionId: string };

/** Answer a question ({ answer }) or change its status ({ status: OPEN | DISMISSED }). */
export const PATCH = route<P>(async ({ auth, params, req, ip, requestId }) => {
  const input = await readJson(req, questionUpdateSchema);
  const meta = { ip, requestId };
  return json({
    question: await updateQuestion(auth, params.projectId, params.questionId, input, meta),
  });
});
