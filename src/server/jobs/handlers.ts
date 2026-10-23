import type { JobType } from "@/generated/prisma/client";
import { extractTextHandler } from "@/server/jobs/processors/extract-text";
import type { JobHandler } from "@/server/jobs/runner";

export const JOB_HANDLERS: Partial<Record<JobType, JobHandler>> = {
  EXTRACT_TEXT: extractTextHandler,
};
