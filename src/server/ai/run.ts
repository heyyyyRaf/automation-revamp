import { assertWithinBudget } from "@/server/ai/budget";
import { toStrictJsonSchema } from "@/server/ai/json-schema";
import { estimateTokens } from "@/server/ai/prompt";
import { getAIProvider } from "@/server/ai/provider";
import { AIError, type StructuredRequest, type TokenUsage } from "@/server/ai/types";
import { db } from "@/server/db";
import { logger } from "@/server/logger";

/**
 * The only way the app calls an AI model:
 * budget check → provider call → token usage recorded → output validated with Zod.
 * Nothing the model returns is used unless it passes validation.
 */
export async function runStructured<T>(
  ctx: { projectId: string; jobId?: string | undefined },
  request: StructuredRequest<T>,
): Promise<T> {
  const chars =
    request.system.length +
    request.content.reduce((n, p) => n + (p.type === "text" ? p.text.length : 0), 0);
  const images = request.content.filter((p) => p.type === "image").length;
  await assertWithinBudget(ctx.projectId, estimateTokens(chars, images) + request.maxOutputTokens);

  const provider = getAIProvider();
  let raw: unknown;
  try {
    const result = await provider.generate(
      request as StructuredRequest<unknown>,
      toStrictJsonSchema(request.schema),
    );
    await recordUsage(ctx, request, provider.name, result.model, result.usage);
    raw = result.raw;
  } catch (err) {
    if (err instanceof AIError && err.usage) {
      await recordUsage(ctx, request, provider.name, "unknown", err.usage);
    }
    throw err;
  }

  const parsed = request.schema.safeParse(raw);
  if (!parsed.success) {
    // Log only where validation failed — never the content itself.
    logger.warn(
      {
        schema: request.schemaName,
        issues: parsed.error.issues.slice(0, 10).map((i) => i.path.join(".")),
      },
      "AI output failed validation",
    );
    throw new AIError("invalid_output", "The AI returned an answer in the wrong format.", true);
  }
  return parsed.data;
}

async function recordUsage(
  ctx: { projectId: string; jobId?: string | undefined },
  request: StructuredRequest<unknown>,
  provider: string,
  model: string,
  usage: TokenUsage,
): Promise<void> {
  try {
    await db.aiUsage.create({
      data: {
        projectId: ctx.projectId,
        jobId: ctx.jobId ?? null,
        provider,
        model,
        purpose: request.purpose,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      },
    });
  } catch (err) {
    logger.error({ err }, "failed to record AI usage");
  }
}
