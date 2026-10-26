import { aiSettingsSchema } from "@/lib/validation";
import { requirePermission } from "@/server/authz/guards";
import { json, readJson, route } from "@/server/http/handler";
import { effectiveAiSettings, updateAiSettings } from "@/server/services/settings";

export const GET = route(async ({ auth }) => {
  requirePermission(auth, "settings:manage");
  return json({ settings: await effectiveAiSettings() });
});

export const PATCH = route(async ({ auth, req, ip, requestId }) => {
  const input = await readJson(req, aiSettingsSchema);
  return json({ settings: await updateAiSettings(auth, input, { ip, requestId }) });
});
