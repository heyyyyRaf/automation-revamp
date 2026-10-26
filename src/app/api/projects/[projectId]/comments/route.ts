import { z } from "zod";
import { commentCreateSchema } from "@/lib/validation";
import { json, readJson, route } from "@/server/http/handler";
import { createComment, listComments } from "@/server/services/comments";

type P = { projectId: string };

const querySchema = z.object({
  targetType: z.enum(["TEST_CASE", "RUN"]),
  targetId: z.string().max(40),
});

/** GET ?targetType=TEST_CASE&targetId=... lists the thread. */
export const GET = route<P>(async ({ auth, params, req }) => {
  const q = querySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
  return json({ comments: await listComments(auth, params.projectId, q.targetType, q.targetId) });
});

export const POST = route<P>(async ({ auth, params, req, ip, requestId }) => {
  const input = await readJson(req, commentCreateSchema);
  const comment = await createComment(auth, params.projectId, input, { ip, requestId });
  return json({ comment }, 201);
});
