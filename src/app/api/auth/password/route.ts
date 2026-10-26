import { changePasswordSchema } from "@/lib/validation";
import { json, readJson, route } from "@/server/http/handler";
import { changeOwnPassword } from "@/server/services/users";

/** Settings → Your account → Change password. Other sessions are signed out. */
export const POST = route(async ({ auth, req, ip, requestId }) => {
  const input = await readJson(req, changePasswordSchema);
  await changeOwnPassword(auth, input, { ip, requestId });
  return json({ ok: true });
});
