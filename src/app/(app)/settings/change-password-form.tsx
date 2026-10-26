"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { api, ApiError } from "@/lib/api-client";
import { PASSWORD_RULES } from "@/lib/validation";

const RULES = [
  { label: "8 characters or more", ok: (p: string) => p.length >= 8 },
  { label: "A capital letter", ok: (p: string) => /\p{Lu}/u.test(p) },
  { label: "A number", ok: (p: string) => /\p{Nd}/u.test(p) },
  { label: "A special character", ok: (p: string) => /[^\p{L}\p{N}\s]/u.test(p) },
];

/** Settings → Your account: change your own password (other devices are signed out). */
export function ChangePasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string[] | undefined>>({});
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);

  const mismatch = confirm.length > 0 && confirm !== next;
  const valid = RULES.every((r) => r.ok(next)) && next === confirm && current.length > 0;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setFields({});
    setDone(false);
    try {
      await api("/api/auth/password", {
        json: { currentPassword: current, newPassword: next },
      });
      setCurrent("");
      setNext("");
      setConfirm("");
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFields(err.fieldErrors);
      } else setError("Couldn't change your password. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="flex max-w-md flex-col gap-4">
      <h3 className="font-bold">Change password</h3>
      {done && (
        <Alert tone="success">
          Password changed. You stay signed in here; other devices were signed out.
        </Alert>
      )}
      {error && <Alert tone="error">{error}</Alert>}
      <Field label="Current password" htmlFor="pw-current" error={fields.currentPassword?.[0]}>
        <Input
          id="pw-current"
          type="password"
          autoComplete="current-password"
          value={current}
          maxLength={128}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </Field>
      <Field
        label="New password"
        htmlFor="pw-new"
        hint={PASSWORD_RULES}
        error={fields.newPassword?.[0]}
      >
        <Input
          id="pw-new"
          type="password"
          autoComplete="new-password"
          value={next}
          maxLength={128}
          aria-describedby="pw-rules"
          onChange={(e) => setNext(e.target.value)}
        />
      </Field>
      <ul id="pw-rules" className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
        {RULES.map((r) => {
          const ok = r.ok(next);
          return (
            <li key={r.label} className={ok ? "text-success" : "text-muted"}>
              <span aria-hidden>{ok ? "✓" : "•"}</span> {r.label}
              <span className="sr-only">{ok ? " (done)" : " (missing)"}</span>
            </li>
          );
        })}
      </ul>
      <Field
        label="Repeat new password"
        htmlFor="pw-confirm"
        error={mismatch ? "The two passwords don't match." : undefined}
      >
        <Input
          id="pw-confirm"
          type="password"
          autoComplete="new-password"
          value={confirm}
          maxLength={128}
          aria-invalid={mismatch || undefined}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </Field>
      <div>
        <Button type="submit" disabled={!valid || saving}>
          {saving ? "Saving…" : "Change password"}
        </Button>
      </div>
    </form>
  );
}
