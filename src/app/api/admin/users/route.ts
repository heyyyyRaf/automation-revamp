import { createUserSchema } from "@/lib/validation";
import { requirePermission } from "@/server/authz/guards";
import { json, readJson, route } from "@/server/http/handler";
import { createUser, listUsers } from "@/server/services/users";

export const GET = route(async ({ auth }) => {
  requirePermission(auth, "users:manage");
  return json({ users: await listUsers() });
});

export const POST = route(async ({ auth, req, ip, requestId }) => {
  requirePermission(auth, "users:manage");
  const input = await readJson(req, createUserSchema);
  return json({ user: await createUser(input, auth.user.id, { ip, requestId }) }, 201);
});
