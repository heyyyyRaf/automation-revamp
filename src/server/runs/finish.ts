import type { RunStatus, TestCaseStatus, TestResultStatus } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { getRunBus } from "@/server/runs/bus";

const FINAL_TEST: TestResultStatus[] = ["PASSED", "FAILED", "ERROR", "SKIPPED"];
export const FINAL_RUN: RunStatus[] = ["PASSED", "FAILED", "ERROR", "CANCELLED", "ABORTED"];

/** A case's lifecycle status after it ran (FRD: Scripted → Passed / Failed / Error). */
const CASE_STATUS: Partial<Record<TestResultStatus, TestCaseStatus>> = {
  PASSED: "PASSED",
  FAILED: "FAILED",
  ERROR: "ERROR",
};

/**
 * Closes a run: tests that never finished are marked (skipped when the run was stopped or
 * aborted — completed results are kept), counts are stored, case statuses follow the
 * results, and the live view is told.
 */
export async function finishRun(
  runId: string,
  outcome: "completed" | "cancelled" | "aborted" | "error",
  message: string | null = null,
): Promise<RunStatus> {
  const unfinishedNote =
    outcome === "cancelled"
      ? "Not run: the run was stopped."
      : outcome === "aborted"
        ? "Not run: the run was aborted."
        : outcome === "error"
          ? "Not run."
          : "This test did not start. The script may not compile — open it on the Scripts page.";
  await db.runTest.updateMany({
    where: { runId, status: { notIn: FINAL_TEST } },
    data: {
      status: outcome === "completed" ? "ERROR" : "SKIPPED",
      errorMessage: unfinishedNote,
    },
  });
  const tests = await db.runTest.findMany({
    where: { runId },
    select: { status: true, testCaseId: true },
  });
  const count = (s: TestResultStatus) => tests.filter((t) => t.status === s).length;
  const passed = count("PASSED");
  const failed = count("FAILED");
  const errors = count("ERROR");
  const skipped = count("SKIPPED");
  const status: RunStatus =
    outcome === "cancelled"
      ? "CANCELLED"
      : outcome === "aborted"
        ? "ABORTED"
        : outcome === "error"
          ? "ERROR"
          : failed + errors > 0
            ? "FAILED"
            : "PASSED";
  await db.$transaction(async (tx) => {
    await tx.run.update({
      where: { id: runId },
      data: {
        status,
        finishedAt: new Date(),
        pausedAt: null,
        passedCount: passed,
        failedCount: failed,
        errorCount: errors,
        skippedCount: skipped,
        error: message,
      },
    });
    for (const t of tests) {
      const next = CASE_STATUS[t.status];
      if (next) {
        await tx.testCase.updateMany({
          where: {
            id: t.testCaseId,
            deletedAt: null,
            status: { in: ["SCRIPTED", "PASSED", "FAILED", "ERROR"] },
          },
          data: { status: next },
        });
      }
    }
  });
  const bus = getRunBus();
  await bus
    .publish(runId, {
      type: "run",
      status,
      passed,
      failed,
      errors,
      skipped,
      error: message,
    })
    .catch(() => undefined);
  await bus.publish(runId, { type: "end", status }).catch(() => undefined);
  return status;
}

/** For the job's final-failure hook: a crashed worker aborts the run, keeping results. */
export async function abortRunAfterCrash(runId: string, projectId: string, message: string) {
  const run = await db.run.findFirst({ where: { id: runId, projectId } });
  if (!run || FINAL_RUN.includes(run.status)) return;
  await finishRun(run.id, "aborted", message);
}
