import { json, route } from "@/server/http/handler";
import { removeMember } from "@/server/services/members";

export const DELETE = route<{ projectId: string; userId: string }>(
  async ({ auth, params, ip, requestId }) => {
    await removeMember(auth, params.projectId, params.userId, { ip, requestId });
    return json({ ok: true });
  },
);
