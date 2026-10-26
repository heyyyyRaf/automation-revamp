import { route } from "@/server/http/handler";
import { revokeShare } from "@/server/services/shares";

type P = { projectId: string; runId: string; shareId: string };

export const DELETE = route<P>(async ({ auth, params, ip, requestId }) => {
  await revokeShare(auth, params.projectId, params.runId, params.shareId, { ip, requestId });
  return new Response(null, { status: 204 });
});
