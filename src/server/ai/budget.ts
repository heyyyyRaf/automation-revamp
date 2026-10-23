import { db } from "@/server/db";
import { getEnv } from "@/server/env";
import { AIError } from "@/server/ai/types";

export function startOfMonthUtc(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export interface AiBudget {
  used: number;
  cap: number;
  remaining: number;
}

export async function getAiBudget(projectId: string, now = new Date()): Promise<AiBudget> {
  const [project, agg] = await Promise.all([
    db.project.findUnique({ where: { id: projectId }, select: { monthlyTokenCap: true } }),
    db.aiUsage.aggregate({
      where: { projectId, createdAt: { gte: startOfMonthUtc(now) } },
      _sum: { inputTokens: true, outputTokens: true },
    }),
  ]);
  const used = (agg._sum.inputTokens ?? 0) + (agg._sum.outputTokens ?? 0);
  const cap = project?.monthlyTokenCap ?? getEnv().AI_MONTHLY_TOKEN_CAP;
  return { used, cap, remaining: Math.max(0, cap - used) };
}

/** Refuses a call that would push the project over its monthly cap. */
export async function assertWithinBudget(
  projectId: string,
  estimatedTokens: number,
): Promise<void> {
  const { used, cap } = await getAiBudget(projectId);
  if (used + estimatedTokens > cap) {
    throw new AIError(
      "budget",
      `This project has reached its monthly AI limit (${used.toLocaleString("en-US")} of ${cap.toLocaleString("en-US")} tokens used). Ask an Admin to raise the limit, or try next month.`,
      false,
    );
  }
}
