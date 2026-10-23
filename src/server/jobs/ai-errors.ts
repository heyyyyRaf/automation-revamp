import { AIError } from "@/server/ai/types";
import { JobFailure } from "@/server/jobs/runner";

/** Converts AI errors into job failures with the same user-safe message and retry decision. */
export function toJobFailure(err: unknown): unknown {
  if (err instanceof AIError) return new JobFailure(err.userMessage, err.retryable);
  return err;
}
