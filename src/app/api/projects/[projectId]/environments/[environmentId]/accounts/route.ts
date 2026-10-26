import { accountCreateSchema } from "@/lib/validation";
import { json, readJson, route } from "@/server/http/handler";
import { addAccount } from "@/server/services/environments";

type P = { projectId: string; environmentId: string };

/** Credentials are write-only: the response holds the masked username, never the password. */
export const POST = route<P>(async ({ auth, params, req, ip, requestId }) => {
  const input = await readJson(req, accountCreateSchema);
  const account = await addAccount(
    auth,
    { projectId: params.projectId },
    params.environmentId,
    input,
    {
      ip,
      requestId,
    },
  );
  return json({ account }, 201);
});
