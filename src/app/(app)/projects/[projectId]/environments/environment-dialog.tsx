"use client";

import { useState } from "react";
import { PlusIcon } from "@/components/icons";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { api, ApiError } from "@/lib/api-client";
import type { EnvironmentItem, TargetItem } from "@/lib/types";

/** Create or edit an environment (FR-7.1: base URL, variables; sign-in settings for FR-7.3). */
export function EnvironmentDialog({
  apiBase,
  environment,
  targets,
  onClose,
  onSaved,
}: {
  /** /api/projects/<id>/environments or /api/admin/environments */
  apiBase: string;
  environment: EnvironmentItem | null;
  /** Approved addresses this environment may use. */
  targets: TargetItem[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const current = environment
    ? targets.find((t) => environment.baseUrl.startsWith(t.origin))
    : undefined;
  const [name, setName] = useState(environment?.name ?? "");
  const [targetId, setTargetId] = useState(current?.id ?? targets[0]?.id ?? "");
  const [basePath, setBasePath] = useState(
    environment && current ? environment.baseUrl.slice(current.origin.length) : "",
  );
  const [needsLogin, setNeedsLogin] = useState(Boolean(environment?.loginConfig));
  const [login, setLogin] = useState({
    path: environment?.loginConfig?.path ?? "/login",
    usernameLabel: environment?.loginConfig?.usernameLabel ?? "Email",
    passwordLabel: environment?.loginConfig?.passwordLabel ?? "Password",
    submitLabel: environment?.loginConfig?.submitLabel ?? "Sign in",
    successText: environment?.loginConfig?.successText ?? "",
    successUrlContains: environment?.loginConfig?.successUrlContains ?? "",
  });
  const [variables, setVariables] = useState(environment?.variables ?? []);
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const body = {
      name,
      targetId,
      basePath: basePath || undefined,
      variables: variables.filter((v) => v.name.trim()),
      loginConfig: needsLogin
        ? {
            ...login,
            successText: login.successText || null,
            successUrlContains: login.successUrlContains || null,
          }
        : null,
    };
    try {
      if (environment) {
        await api(`${apiBase}/${environment.id}`, { method: "PATCH", json: body });
        onSaved(`${name} was saved.`);
      } else {
        await api(apiBase, { json: body });
        onSaved(`${name} was added. Add a test account, then run its check.`);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError("Couldn't save.", 0, "UNKNOWN"));
      setPending(false);
    }
  }

  const fe = (k: string) => error?.fieldErrors[k]?.[0];
  const setL = (k: keyof typeof login) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setLogin((l) => ({ ...l, [k]: e.target.value }));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        wide
        title={environment ? `Edit ${environment.name}` : "New environment"}
        description="Where the tests run. Changing the address or sign-in makes it Unverified until it is checked again."
      >
        <form onSubmit={save} className="flex flex-col gap-4">
          {error && Object.keys(error.fieldErrors).length === 0 && (
            <Alert tone="error">{error.message}</Alert>
          )}
          {targets.length === 0 && (
            <Alert tone="info">
              No approved address yet. Request one in “Addresses” — the Lead approves it.
            </Alert>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="env-name" error={fe("name")} hint="e.g. Staging, UAT">
              <Input
                id="env-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={60}
              />
            </Field>
            <Field label="Address" htmlFor="env-target" error={fe("targetId")}>
              <Select
                id="env-target"
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                required
              >
                {targets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.origin}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field
            label="Path (optional)"
            htmlFor="env-path"
            hint="If the app lives under a path, e.g. /app."
            error={fe("basePath")}
          >
            <Input
              id="env-path"
              value={basePath}
              onChange={(e) => setBasePath(e.target.value)}
              maxLength={300}
            />
          </Field>

          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              className="accent-accent size-5"
              checked={needsLogin}
              onChange={(e) => setNeedsLogin(e.target.checked)}
            />
            <span className="text-sm font-semibold">
              The app needs sign-in (tests reuse one saved session)
            </span>
          </label>
          {needsLogin && (
            <fieldset className="border-line grid gap-4 rounded-xl border p-4 sm:grid-cols-2">
              <legend className="text-ink-2 px-1 text-sm font-semibold">Sign-in page</legend>
              <Field label="Sign-in page path" htmlFor="l-path">
                <Input id="l-path" value={login.path} onChange={setL("path")} required />
              </Field>
              <Field label="Sign-in button text" htmlFor="l-submit">
                <Input
                  id="l-submit"
                  value={login.submitLabel}
                  onChange={setL("submitLabel")}
                  required
                />
              </Field>
              <Field label="Username field label" htmlFor="l-user">
                <Input
                  id="l-user"
                  value={login.usernameLabel}
                  onChange={setL("usernameLabel")}
                  required
                />
              </Field>
              <Field label="Password field label" htmlFor="l-pass">
                <Input
                  id="l-pass"
                  value={login.passwordLabel}
                  onChange={setL("passwordLabel")}
                  required
                />
              </Field>
              <Field
                label="Text shown after signing in (optional)"
                htmlFor="l-text"
                hint="e.g. Welcome back"
              >
                <Input id="l-text" value={login.successText} onChange={setL("successText")} />
              </Field>
              <Field
                label="Address after signing in contains (optional)"
                htmlFor="l-url"
                hint="e.g. /dashboard"
              >
                <Input
                  id="l-url"
                  value={login.successUrlContains}
                  onChange={setL("successUrlContains")}
                />
              </Field>
            </fieldset>
          )}

          <fieldset className="flex flex-col gap-2">
            <legend className="text-ink-2 text-sm font-semibold">Variables (not secret)</legend>
            <p className="text-muted text-[13px]">
              Settings scripts can read as vars.NAME — never passwords (add those as test accounts).
            </p>
            {fe("variables") && <p className="text-warn text-[13px]">{fe("variables")}</p>}
            {variables.map((v, i) => (
              <div key={i} className="flex gap-2">
                <label htmlFor={`var-name-${i}`} className="sr-only">
                  Variable name
                </label>
                <Input
                  id={`var-name-${i}`}
                  placeholder="SHOP_NAME"
                  value={v.name}
                  className="w-1/3 font-mono"
                  onChange={(e) =>
                    setVariables((vs) =>
                      vs.map((x, j) =>
                        j === i ? { ...x, name: e.target.value.toUpperCase() } : x,
                      ),
                    )
                  }
                />
                <label htmlFor={`var-value-${i}`} className="sr-only">
                  Value
                </label>
                <Input
                  id={`var-value-${i}`}
                  placeholder="Value"
                  value={v.value}
                  onChange={(e) =>
                    setVariables((vs) =>
                      vs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)),
                    )
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label="Remove variable"
                  onClick={() => setVariables((vs) => vs.filter((_, j) => j !== i))}
                >
                  Remove
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={() => setVariables((vs) => [...vs, { name: "", value: "" }])}
            >
              <PlusIcon /> Add variable
            </Button>
          </fieldset>

          <div className="border-line-soft flex gap-2 border-t pt-4">
            <Button type="submit" disabled={pending || targets.length === 0}>
              {pending ? "Saving…" : environment ? "Save changes" : "Add environment"}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
