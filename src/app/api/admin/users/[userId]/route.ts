import { updateUserSchema } from "@/lib/validation";
import { isValidId, requirePermission } from "@/server/authz/guards";
import { notFound } from "@/server/errors";
import { json, readJson, route } from "@/server/http/handler";
import { updateUser } from "@/server/services/users";

export const PATCH = route<{ userId: string }>(async ({ auth, req, params, ip, requestId }) => {
  requirePermission(auth, "users:manage");
  if (!isValidId(params.userId)) throw notFound("User");
  const input = await readJson(req, updateUserSchema);
  return json({ user: await updateUser(params.userId, input, auth.user.id, { ip, requestId }) });
});
