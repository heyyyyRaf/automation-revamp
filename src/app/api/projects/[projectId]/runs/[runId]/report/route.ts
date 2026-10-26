import { json, route } from "@/server/http/handler";
import { getRunReport } from "@/server/services/reports";

type P = { projectId: string; runId: string };

/** FR-9.1 run report (totals, failures with likely cause, manual cases, coverage). */
export const GET = route<P>(async ({ auth, params }) =>
  json({ report: await getRunReport(auth, params.projectId, params.runId) }),
);
