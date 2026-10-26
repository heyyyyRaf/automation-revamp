import { z } from "zod";
import { TEST_CASE_STATUSES, TEST_CASE_TYPES } from "@/lib/domain";
import type { TestCaseFilters } from "@/server/services/test-cases";

const filterSchema = z.object({
  status: z.enum(TEST_CASE_STATUSES).optional(),
  requirementId: z.string().max(40).optional(),
  scenarioId: z.string().max(40).optional(),
  type: z.enum(TEST_CASE_TYPES).optional(),
  manual: z.enum(["1"]).optional(),
  tag: z.string().trim().max(30).optional(),
});

/** Query-string filters shared by the list and the export. */
export function testCaseFilters(query: Record<string, string>): TestCaseFilters {
  const f = filterSchema.parse(query);
  return {
    status: f.status,
    requirementId: f.requirementId,
    scenarioId: f.scenarioId,
    type: f.type,
    manualOnly: f.manual === "1",
    tag: f.tag,
  };
}
