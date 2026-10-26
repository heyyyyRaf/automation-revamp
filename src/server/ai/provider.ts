import { FakeProvider } from "@/server/ai/fake-provider";
import { OpenAIProvider } from "@/server/ai/openai-provider";
import { AIError, type AIProvider } from "@/server/ai/types";
import { getEnv } from "@/server/env";
import { logger } from "@/server/logger";
import { getAiSettings } from "@/server/services/settings";

let override: AIProvider | undefined;
const byModel = new Map<string, AIProvider>();
let fake: FakeProvider | undefined;

/**
 * The configured provider. The model comes from the Lead's AI settings, falling back to
 * OPENAI_MODEL. Missing configuration surfaces as a friendly, non-retryable job error.
 */
export async function getAIProvider(): Promise<AIProvider> {
  if (override) return override;
  const env = getEnv();
  if (env.AI_PROVIDER === "fake") return getFakeProvider();
  const model = (await getAiSettings()).model ?? env.OPENAI_MODEL;
  if (!env.OPENAI_API_KEY || !model) {
    throw new AIError(
      "config",
      "AI isn't set up yet. Ask an Admin to configure the OpenAI API key and model.",
      false,
    );
  }
  let provider = byModel.get(model);
  if (!provider) {
    provider = new OpenAIProvider({
      apiKey: env.OPENAI_API_KEY,
      model,
      baseURL: env.OPENAI_BASE_URL,
    });
    byModel.set(model, provider);
  }
  return provider;
}

/** The offline demo generator (AI_PROVIDER=fake); tests use it to inspect calls. */
export function getFakeProvider(): FakeProvider {
  if (override instanceof FakeProvider) return override;
  if (!fake) {
    logger.warn("AI_PROVIDER=fake: using the offline demo generator, not a real AI");
    fake = new FakeProvider();
  }
  return fake;
}

/** Tests only. */
export function setAIProvider(provider: AIProvider | undefined): void {
  override = provider;
}
