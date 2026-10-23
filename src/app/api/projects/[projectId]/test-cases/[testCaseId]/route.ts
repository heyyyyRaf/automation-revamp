import { testCaseUpdateSchema } from "@/lib/validation";
import { json, readJson, route } from "@/server/http/handler";
import { deleteTestCase, getTestCase, updateTestCase } from "@/server/services/test-cases";

type P = { projectId: string; testCaseId: string };

export const GET = route<P>(async ({ auth, params }) =>
  json({ testCase: await getTestCase(auth, params.projectId, params.testCaseId) }),
);

/** Editing always returns the test case to DRAFT; it must be approved again. */
export const PATCH = route<P>(async ({ auth, params, req, ip, requestId }) => {
  const input = await readJson(req, testCaseUpdateSchema);
  const meta = { ip, requestId };
  return json({
    testCase: await updateTestCase(auth, params.projectId, params.testCaseId, input, meta),
  });
});

export const DELETE = route<P>(async ({ auth, params, ip, requestId }) => {
  await deleteTestCase(auth, params.projectId, params.testCaseId, { ip, requestId });
  return json({ ok: true });
});
