import { exportCreateSchema } from "@/lib/validation";
import { json, readJson, route } from "@/server/http/handler";
import { createExport, listExports } from "@/server/services/exports";

type P = { projectId: string };

export const GET = route<P>(async ({ auth, params }) =>
  json({ exports: await listExports(auth, params.projectId) }),
);

export const POST = route<P>(async ({ auth, params, req, ip, requestId }) => {
  const { format } = await readJson(req, exportCreateSchema);
  const created = await createExport(auth, params.projectId, format, { ip, requestId });
  return json({ export: created }, 202);
});
