import { DEFECT_STATUSES, defectCreateSchema } from "@/lib/validation";
import { json, readJson, route } from "@/server/http/handler";
import { createDefect, listDefects } from "@/server/services/defects";

type P = { projectId: string };

export const GET = route<P>(async ({ auth, params, req }) => {
  const s = req.nextUrl.searchParams.get("status");
  const status = (DEFECT_STATUSES as readonly string[]).includes(s ?? "")
    ? (s as (typeof DEFECT_STATUSES)[number])
    : undefined;
  return json({ defects: await listDefects(auth, params.projectId, status) });
});

/** FRD step 7: log a failed case as a defect. */
export const POST = route<P>(async ({ auth, params, req, ip, requestId }) => {
  const input = await readJson(req, defectCreateSchema);
  return json(
    { defect: await createDefect(auth, params.projectId, input, { ip, requestId }) },
    201,
  );
});
