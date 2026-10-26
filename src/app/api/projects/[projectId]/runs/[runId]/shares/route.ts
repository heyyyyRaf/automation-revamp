import { shareCreateSchema } from "@/lib/validation";
import { json, readJson, route } from "@/server/http/handler";
import { createShare, listShares } from "@/server/services/shares";

type P = { projectId: string; runId: string };

export const GET = route<P>(async ({ auth, params }) =>
  json({ shares: await listShares(auth, params.projectId, params.runId) }),
);

/** FR-9.4 option (b): Lead only. The token is in this response and nowhere else. */
export const POST = route<P>(async ({ auth, params, req, ip, requestId }) => {
  const { days } = await readJson(req, shareCreateSchema);
  const share = await createShare(auth, params.projectId, params.runId, days, { ip, requestId });
  return new Response(JSON.stringify({ share }), {
    status: 201,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
});
