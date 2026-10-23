import type { Prisma } from "@/generated/prisma/client";

type Tx = Pick<Prisma.TransactionClient, "project">;

/**
 * Reserves `count` sequential human-readable keys (REQ-001, TC-014, ...) for a project.
 * The UPDATE row-locks the project, so concurrent transactions never get the same numbers.
 */
export async function allocateKeys(
  tx: Tx,
  projectId: string,
  kind: "REQ" | "TC",
  count: number,
): Promise<string[]> {
  if (count <= 0) return [];
  const field = kind === "REQ" ? "nextRequirementNo" : "nextTestCaseNo";
  const updated = await tx.project.update({
    where: { id: projectId },
    data: { [field]: { increment: count } },
    select: { nextRequirementNo: true, nextTestCaseNo: true },
  });
  const end = kind === "REQ" ? updated.nextRequirementNo : updated.nextTestCaseNo;
  const start = end - count;
  return Array.from({ length: count }, (_, i) => `${kind}-${String(start + i).padStart(3, "0")}`);
}
