import type { JobType } from "@/generated/prisma/client";
import { getEnv } from "@/server/env";
import { analyzeRequirementsHandler } from "@/server/jobs/processors/analyze-requirements";
import { exportHandler } from "@/server/jobs/processors/export";
import { extractTextHandler } from "@/server/jobs/processors/extract-text";
import { generateTestCasesHandler } from "@/server/jobs/processors/generate-test-cases";
import { importFigmaHandler } from "@/server/jobs/processors/import-figma";
import { rewriteTestCaseHandler } from "@/server/jobs/processors/rewrite-test-case";
import type { JobHandler } from "@/server/jobs/runner";

export const JOB_HANDLERS: Partial<Record<JobType, JobHandler>> = {
  EXTRACT_TEXT: extractTextHandler,
  IMPORT_FIGMA: importFigmaHandler,
  ANALYZE_REQUIREMENTS: analyzeRequirementsHandler,
  GENERATE_TEST_CASES: generateTestCasesHandler,
  REWRITE_TEST_CASE: rewriteTestCaseHandler,
  EXPORT: exportHandler,
};

/** Per-attempt hard timeout. AI jobs make many sequential model calls, so they get longer. */
export function timeoutMsFor(type: JobType): number {
  const env = getEnv();
  switch (type) {
    case "ANALYZE_REQUIREMENTS":
    case "GENERATE_TEST_CASES":
      return env.AI_JOB_TIMEOUT_SECONDS * 1000;
    case "EXPORT":
    case "IMPORT_FIGMA":
      return Math.min(env.JOB_TIMEOUT_SECONDS, 180) * 1000;
    default:
      return env.JOB_TIMEOUT_SECONDS * 1000;
  }
}
