import type { z } from "zod";
import type { aiSettingsSchema } from "@/lib/validation";
import type { AuthContext } from "@/server/auth/session";
import { requirePermission } from "@/server/authz/guards";
import { db } from "@/server/db";
import { getEnv } from "@/server/env";
import { audit, changes } from "@/server/services/audit";

/**
 * Lead-managed AI/model settings (FRD roles table). The API key is a server secret and is
 * never stored here; only the model name and the default monthly token cap are.
 */
export interface AiSettings {
  /** Model override; null = use OPENAI_MODEL from the environment. */
  model: string | null;
  /** Default monthly cap per project; null = use AI_MONTHLY_TOKEN_CAP. Projects may override. */
  defaultMonthlyTokenCap: number | null;
}

const AI_KEY = "ai";
const CACHE_MS = 15_000;
let cache: { value: AiSettings; at: number } | undefined;

export async function getAiSettings(): Promise<AiSettings> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const row = await db.appSetting.findUnique({ where: { key: AI_KEY } });
  const v = (row?.value ?? {}) as Partial<AiSettings>;
  const value: AiSettings = {
    model: typeof v.model === "string" && v.model ? v.model : null,
    defaultMonthlyTokenCap:
      typeof v.defaultMonthlyTokenCap === "number" ? v.defaultMonthlyTokenCap : null,
  };
  cache = { value, at: Date.now() };
  return value;
}

/** What is actually in effect, for display. */
export async function effectiveAiSettings() {
  const env = getEnv();
  const s = await getAiSettings();
  return {
    ...s,
    provider: env.AI_PROVIDER,
    effectiveModel: s.model ?? env.OPENAI_MODEL ?? null,
    effectiveDefaultCap: s.defaultMonthlyTokenCap ?? env.AI_MONTHLY_TOKEN_CAP,
    apiKeyConfigured: Boolean(env.OPENAI_API_KEY),
  };
}

export async function updateAiSettings(
  auth: AuthContext,
  input: z.infer<typeof aiSettingsSchema>,
  meta: { ip: string; requestId: string },
) {
  requirePermission(auth, "settings:manage");
  const before = await getAiSettings();
  const next: AiSettings = {
    model: input.model !== undefined ? input.model : before.model,
    defaultMonthlyTokenCap:
      input.defaultMonthlyTokenCap !== undefined
        ? input.defaultMonthlyTokenCap
        : before.defaultMonthlyTokenCap,
  };
  await db.appSetting.upsert({
    where: { key: AI_KEY },
    create: { key: AI_KEY, value: { ...next }, updatedById: auth.user.id },
    update: { value: { ...next }, updatedById: auth.user.id },
  });
  cache = undefined;
  const diff = changes({ ...before }, { ...next }, ["model", "defaultMonthlyTokenCap"]);
  await audit({
    action: "settings.update",
    entityType: "setting",
    entityId: AI_KEY,
    actorId: auth.user.id,
    ...(diff ?? {}),
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });
  return effectiveAiSettings();
}

/** Tests only. */
export function resetSettingsCache(): void {
  cache = undefined;
}
