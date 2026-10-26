import { testCaseExportSchema } from "@/lib/validation";
import { downloadResponse } from "@/server/http/download";
import { route } from "@/server/http/handler";
import { exportTestCases } from "@/server/services/test-cases";
import { testCaseFilters } from "../filters";

/** FR-4.6: download the (filtered) test cases with every field, as CSV or Excel. */
export const GET = route<{ projectId: string }>(async ({ auth, params, req, ip, requestId }) => {
  const query = Object.fromEntries(req.nextUrl.searchParams);
  const { format } = testCaseExportSchema.parse(query);
  const file = await exportTestCases(auth, params.projectId, format, testCaseFilters(query), {
    ip,
    requestId,
  });
  return downloadResponse(file);
});
