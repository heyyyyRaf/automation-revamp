import { testCaseReviewSchema } from "@/lib/validation";
import { json, readJson, route } from "@/server/http/handler";
import { reviewTestCases } from "@/server/services/test-cases";

/** Approve, reject (with a reason) or reopen one or more test cases. */
export const POST = route<{ projectId: string }>(async ({ auth, params, req, ip, requestId }) => {
  const input = await readJson(req, testCaseReviewSchema);
  return json(await reviewTestCases(auth, params.projectId, input, { ip, requestId }));
});
