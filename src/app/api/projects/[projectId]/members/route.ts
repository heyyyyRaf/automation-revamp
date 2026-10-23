import { addMemberSchema } from "@/lib/validation";
import { json, readJson, route } from "@/server/http/handler";
import { addMember, listMembers } from "@/server/services/members";

type P = { projectId: string };

export const GET = route<P>(async ({ auth, params }) =>
  json({ members: await listMembers(auth, params.projectId) }),
);

export const POST = route<P>(async ({ auth, req, params, ip, requestId }) => {
  const { userId } = await readJson(req, addMemberSchema);
  await addMember(auth, params.projectId, userId, { ip, requestId });
  return json({ members: await listMembers(auth, params.projectId) }, 201);
});
