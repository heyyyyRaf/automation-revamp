import type { Prisma } from "@/generated/prisma/client";

type Tx = Pick<Prisma.TransactionClient, "project">;

const FIELD = {
  REQ: "nextRequirementNo",
  TC: "nextTestCaseNo",
  SC: "nextScenarioNo",
  BUG: "nextDefectNo",
} as const;

/**
 * Reserves `count` sequential human-readable keys (REQ-001, TC-014, SC-002, ...) for a project.
 * The UPDATE row-locks the project, so concurrent transactions never get the same numbers.
 */
export async function allocateKeys(
  tx: Tx,
  projectId: string,
  kind: keyof typeof FIELD,
  count: number,
): Promise<string[]> {
  if (count <= 0) return [];
  const field = FIELD[kind];
  const updated = await tx.project.update({
    where: { id: projectId },
    data: { [field]: { increment: count } },
    select: {
      nextRequirementNo: true,
      nextTestCaseNo: true,
      nextScenarioNo: true,
      nextDefectNo: true,
    },
  });
  const start = updated[field] - count;
  return Array.from({ length: count }, (_, i) => `${kind}-${String(start + i).padStart(3, "0")}`);
}
