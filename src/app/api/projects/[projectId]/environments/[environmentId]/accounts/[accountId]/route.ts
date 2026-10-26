import { accountUpdateSchema } from "@/lib/validation";
import { json, readJson, route } from "@/server/http/handler";
import { deleteAccount, updateAccount } from "@/server/services/environments";

type P = { projectId: string; environmentId: string; accountId: string };

export const PATCH = route<P>(async ({ auth, params, req, ip, requestId }) => {
  const input = await readJson(req, accountUpdateSchema);
  const account = await updateAccount(
    auth,
    { projectId: params.projectId },
    params.environmentId,
    params.accountId,
    input,
    { ip, requestId },
  );
  return json({ account });
});

export const DELETE = route<P>(async ({ auth, params, ip, requestId }) => {
  await deleteAccount(
    auth,
    { projectId: params.projectId },
    params.environmentId,
    params.accountId,
    {
      ip,
      requestId,
    },
  );
  return json({ ok: true });
});
