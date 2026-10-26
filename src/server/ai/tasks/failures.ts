import { z } from "zod";

export const failureAnalysisSchema = z.object({
  cause: z.enum(["APP_BUG", "SCRIPT_ISSUE", "ENVIRONMENT", "UNKNOWN"]),
  explanation: z.string().trim().min(3).max(300),
});
export type FailureAnalysis = z.infer<typeof failureAnalysisSchema>;
