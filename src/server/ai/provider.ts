import { FakeProvider } from "@/server/ai/fake-provider";
import { OpenAIProvider } from "@/server/ai/openai-provider";
import { AIError, type AIProvider } from "@/server/ai/types";
import { getEnv } from "@/server/env";
import { logger } from "@/server/logger";

let instance: AIProvider | undefined;

/** The configured provider. Missing configuration surfaces as a friendly, non-retryable job error. */
export function getAIProvider(): AIProvider {
  if (instance) return instance;
  const env = getEnv();
  if (env.AI_PROVIDER === "fake") {
    logger.warn("AI_PROVIDER=fake: using the offline demo generator, not a real AI");
    instance = new FakeProvider();
    return instance;
  }
  if (!env.OPENAI_API_KEY || !env.OPENAI_MODEL) {
    throw new AIError(
      "config",
      "AI isn't set up yet. Ask an Admin to configure OPENAI_API_KEY and OPENAI_MODEL.",
      false,
    );
  }
  instance = new OpenAIProvider({
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL,
    baseURL: env.OPENAI_BASE_URL,
  });
  return instance;
}

/** Tests only. */
export function setAIProvider(provider: AIProvider | undefined): void {
  instance = provider;
}
