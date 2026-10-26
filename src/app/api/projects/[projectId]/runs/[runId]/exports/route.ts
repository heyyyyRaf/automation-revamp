import { reportExportSchema } from "@/lib/validation";
import { json, readJson, route } from "@/server/http/handler";
import { createRunReportExport, listExports } from "@/server/services/exports";

type P = { projectId: string; runId: string };

export const GET = route<P>(async ({ auth, params }) =>
  json({ exports: await listExports(auth, params.projectId, params.runId) }),
);

/** FR-9.4: export the report as PDF or HTML (built in the background). */
export const POST = route<P>(async ({ auth, params, req, ip, requestId }) => {
  const { format } = await readJson(req, reportExportSchema);
  const created = await createRunReportExport(auth, params.projectId, params.runId, format, {
    ip,
    requestId,
  });
  return json({ export: created }, 202);
});
