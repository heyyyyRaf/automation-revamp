import type { JobType } from "@/generated/prisma/client";
import { getAiBudget } from "@/server/ai/budget";
import { db } from "@/server/db";
import { conflict } from "@/server/errors";

const BUSY: Partial<Record<JobType, string>> = {
  ANALYZE_REQUIREMENTS: "An analysis is already running for this project.",
  GENERATE_TEST_CASES: "Test case generation is already running for this project.",
  GENERATE_SCRIPT: "Scripts are already being written for this project.",
};

/** One job of this kind at a time per project, so results never interleave. */
export async function assertNotRunning(projectId: string, type: JobType): Promise<void> {
  const active = await db.job.findFirst({
    where: { projectId, type, status: { in: ["QUEUED", "RUNNING"] } },
  });
  if (active) {
    throw conflict(
      `${BUSY[type] ?? "This is already running for this project."} Please wait for it to finish.`,
    );
  }
}

/** NFR-11: no new AI work once the monthly cap is used up. */
export async function assertBudgetLeft(projectId: string): Promise<void> {
  const budget = await getAiBudget(projectId);
  if (budget.remaining <= 0) {
    throw conflict("This project has used its monthly AI limit. Ask an Admin to raise it.");
  }
}
