import { questionCreateSchema } from "@/lib/validation";
import { json, readJson, route } from "@/server/http/handler";
import { createQuestion, listQuestions } from "@/server/services/requirements";

type P = { projectId: string };

export const GET = route<P>(async ({ auth, params }) =>
  json({ questions: await listQuestions(auth, params.projectId) }),
);

export const POST = route<P>(async ({ auth, params, req, ip, requestId }) => {
  const input = await readJson(req, questionCreateSchema);
  const question = await createQuestion(auth, params.projectId, input, { ip, requestId });
  return json({ question }, 201);
});
