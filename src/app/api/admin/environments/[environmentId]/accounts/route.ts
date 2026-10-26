import { accountCreateSchema } from "@/lib/validation";
import { json, readJson, route } from "@/server/http/handler";
import { addAccount } from "@/server/services/environments";

const SHARED = { shared: true } as const;

export const POST = route<{ environmentId: string }>(
  async ({ auth, params, req, ip, requestId }) => {
    const input = await readJson(req, accountCreateSchema);
    const account = await addAccount(auth, SHARED, params.environmentId, input, { ip, requestId });
    return json({ account }, 201);
  },
);
