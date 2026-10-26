import { testCaseCreateSchema } from "@/lib/validation";
import { json, readJson, route } from "@/server/http/handler";
import { createTestCase, listTestCases } from "@/server/services/test-cases";
import { testCaseFilters } from "./filters";

type P = { projectId: string };

export const GET = route<P>(async ({ auth, params, req }) => {
  const filters = testCaseFilters(Object.fromEntries(req.nextUrl.searchParams));
  return json({ testCases: await listTestCases(auth, params.projectId, filters) });
});

export const POST = route<P>(async ({ auth, params, req, ip, requestId }) => {
  const input = await readJson(req, testCaseCreateSchema);
  const testCase = await createTestCase(auth, params.projectId, input, { ip, requestId });
  return json({ testCase }, 201);
});
