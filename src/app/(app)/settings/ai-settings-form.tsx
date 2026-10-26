"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { api, ApiError } from "@/lib/api-client";

export interface AiSettingsView {
  model: string | null;
  defaultMonthlyTokenCap: number | null;
  provider: string;
  effectiveModel: string | null;
  effectiveDefaultCap: number;
  apiKeyConfigured: boolean;
}

/** Lead-managed AI settings. The API key itself is a server secret and never shown here. */
export function AiSettingsForm({ initial }: { initial: AiSettingsView }) {
  const [settings, setSettings] = useState(initial);
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const model = String(f.get("model") ?? "").trim();
    const cap = String(f.get("cap") ?? "").replace(/[,\s]/g, "");
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const res = await api<{ settings: AiSettingsView }>("/api/admin/settings/ai", {
        method: "PATCH",
        json: { model: model || null, defaultMonthlyTokenCap: cap ? Number(cap) : null },
      });
      setSettings(res.settings);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError("Couldn't save.", 0, "UNKNOWN"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card id="ai">
      <CardHeader>
        <CardTitle>AI settings</CardTitle>
        <CardDescription>
          Which model the assistant uses, and the default monthly token limit for each project. The
          API key is set on the server and is never shown or stored here.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex max-w-xl flex-col gap-4">
          {error && Object.keys(error.fieldErrors).length === 0 && (
            <Alert tone="error">{error.message}</Alert>
          )}
          {saved && <Alert tone="success">Saved. New AI work uses these settings.</Alert>}
          {settings.provider === "openai" && !settings.apiKeyConfigured && (
            <Alert tone="error" title="No API key">
              The server has no OpenAI API key, so AI features are off. Ask whoever runs the server
              to set OPENAI_API_KEY.
            </Alert>
          )}
          <Field
            label="Model"
            htmlFor="ai-model"
            hint={`In use now: ${settings.effectiveModel ?? "none set"}. Leave empty to use the server default.`}
            error={error?.fieldErrors["model"]?.[0]}
          >
            <Input
              id="ai-model"
              name="model"
              defaultValue={settings.model ?? ""}
              maxLength={80}
              placeholder="e.g. gpt-5.5"
            />
          </Field>
          <Field
            label="Default monthly limit per project (tokens)"
            htmlFor="ai-cap"
            hint={`In use now: ${settings.effectiveDefaultCap.toLocaleString()}. A project's own limit (set in its settings) wins.`}
            error={error?.fieldErrors["defaultMonthlyTokenCap"]?.[0]}
          >
            <Input
              id="ai-cap"
              name="cap"
              inputMode="numeric"
              defaultValue={settings.defaultMonthlyTokenCap ?? ""}
              placeholder={settings.effectiveDefaultCap.toLocaleString()}
            />
          </Field>
          <Button type="submit" className="self-start" disabled={pending}>
            {pending ? "Saving…" : "Save AI settings"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
