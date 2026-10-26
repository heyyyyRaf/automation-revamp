"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { PlusIcon } from "@/components/icons";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionLabel } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/states";
import { api, ApiError } from "@/lib/api-client";
import { activityLabel } from "@/lib/format";
import { isJobActive, type EnvironmentItem, type JobItem, type TargetItem } from "@/lib/types";
import { usePolling } from "@/lib/use-polling";
import { EnvironmentDialog } from "./environment-dialog";

/**
 * Environments (FR-7). Used for a project's environments and, by the Lead, for shared ones.
 * Credentials are write-only: only masked usernames ever come back from the server.
 */
export function EnvironmentsWorkspace({
  projectId,
  apiBase,
  environments,
  targets,
  canManage,
  canManageShared,
  title = "Environments",
}: {
  /** Set inside a project: enables "Check now" (the check runs as a job of that project). */
  projectId: string | null;
  apiBase: string;
  environments: EnvironmentItem[];
  targets: TargetItem[];
  canManage: boolean;
  canManageShared: boolean;
  title?: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<EnvironmentItem | "new" | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const approved = targets.filter((t) => t.status === "APPROVED");

  function done(text: string) {
    setEditing(null);
    setMessage({ tone: "success", text });
    router.refresh();
  }

  return (
    <section
      aria-labelledby="envs-heading"
      className="flex min-w-0 flex-[999_1_560px] flex-col gap-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="envs-heading" className="text-[19px] font-bold">
          {title}
        </h2>
        {canManage && (
          <Button size="sm" onClick={() => setEditing("new")}>
            <PlusIcon /> New environment
          </Button>
        )}
      </div>
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      {environments.length === 0 ? (
        <EmptyState
          title="No environment yet"
          description="Add the address of the app to test (an approved address), a test account, and run the check."
        />
      ) : (
        environments.map((env) => (
          <EnvironmentCard
            key={env.id}
            env={env}
            projectId={projectId}
            apiBase={apiBase}
            canEdit={env.shared ? canManageShared : canManage}
            canCheck={canManage && projectId !== null}
            onEdit={() => setEditing(env)}
            onMessage={(tone, text) => {
              setMessage({ tone, text });
              router.refresh();
            }}
          />
        ))
      )}
      {editing && (
        <EnvironmentDialog
          apiBase={apiBase}
          environment={editing === "new" ? null : editing}
          targets={approved}
          onClose={() => setEditing(null)}
          onSaved={done}
        />
      )}
    </section>
  );
}

function EnvironmentCard({
  env,
  projectId,
  apiBase,
  canEdit,
  canCheck,
  onEdit,
  onMessage,
}: {
  env: EnvironmentItem;
  projectId: string | null;
  apiBase: string;
  canEdit: boolean;
  canCheck: boolean;
  onEdit: () => void;
  onMessage: (tone: "error" | "success", text: string) => void;
}) {
  const router = useRouter();
  const [job, setJob] = useState<JobItem | null>(null);
  const [addingAccount, setAddingAccount] = useState(false);
  const checking = isJobActive(job);

  const poll = useCallback(async () => {
    if (!job || !projectId) return;
    const { job: fresh } = await api<{ job: JobItem }>(`/api/projects/${projectId}/jobs/${job.id}`);
    setJob(fresh);
    if (!isJobActive(fresh)) router.refresh();
  }, [job, projectId, router]);
  usePolling(poll, checking, 1500);

  async function check() {
    if (!projectId) return;
    try {
      const res = await api<{ job: JobItem }>(
        `/api/projects/${projectId}/environments/${env.id}/verify`,
        { method: "POST" },
      );
      setJob(res.job);
    } catch (err) {
      onMessage("error", err instanceof ApiError ? err.message : "Couldn't start the check.");
    }
  }

  async function remove() {
    if (!window.confirm(`Delete the environment “${env.name}”?`)) return;
    try {
      await api(`${apiBase}/${env.id}`, { method: "DELETE" });
      onMessage("success", `${env.name} was deleted.`);
    } catch (err) {
      onMessage("error", err instanceof ApiError ? err.message : "Couldn't delete it.");
    }
  }

  async function removeAccount(id: string, label: string) {
    if (!window.confirm(`Remove the test account “${label}”?`)) return;
    try {
      await api(`${apiBase}/${env.id}/accounts/${id}`, { method: "DELETE" });
      onMessage("success", `${label} was removed.`);
    } catch (err) {
      onMessage("error", err instanceof ApiError ? err.message : "Couldn't remove it.");
    }
  }

  async function makeDefault(id: string) {
    try {
      await api(`${apiBase}/${env.id}/accounts/${id}`, {
        method: "PATCH",
        json: { isDefault: true },
      });
      onMessage("success", "Default account changed. Run the check again.");
    } catch (err) {
      onMessage("error", err instanceof ApiError ? err.message : "Couldn't change it.");
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[17px] font-bold">{env.name}</h3>
            {env.shared && <Badge tone="purple">Shared</Badge>}
            {checking ? (
              <Badge tone="info">Checking…</Badge>
            ) : env.verified ? (
              <Badge tone="success">Verified</Badge>
            ) : (
              <Badge tone="warning">Unverified</Badge>
            )}
          </div>
          <span className="text-muted font-mono text-[13px] break-all">{env.baseUrl}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {canCheck && (
            <Button
              size="sm"
              variant={env.verified ? "secondary" : "primary"}
              disabled={checking}
              onClick={() => void check()}
            >
              {checking ? "Checking…" : "Check now"}
            </Button>
          )}
          {canEdit && (
            <Button size="sm" variant="secondary" onClick={onEdit}>
              Edit
            </Button>
          )}
          {canEdit && (
            <Button size="sm" variant="ghost" onClick={() => void remove()}>
              Delete
            </Button>
          )}
        </div>
      </div>

      <p className="text-[13px]" suppressHydrationWarning>
        {env.verified && env.verifiedAt ? (
          <span className="text-success">
            {env.loginConfig ? "Signed in and saved the session" : "The start page opens"} ·{" "}
            {activityLabel("checked", env.verifiedAt)}
          </span>
        ) : job?.status === "FAILED" || env.loginCheckError ? (
          <span className="text-warn">
            {job?.status === "FAILED" ? job.error : env.loginCheckError}
          </span>
        ) : (
          <span className="text-muted">
            Runs are blocked until this environment passes its check.
          </span>
        )}
      </p>
      {env.shared && !canCheck && (
        <p className="text-muted text-[13px]">
          A project checks a shared environment from its own Environments page.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <SectionLabel>Test accounts</SectionLabel>
          {env.accounts.length === 0 ? (
            <p className="text-muted text-[13px]">
              {env.loginConfig ? "Add the account the tests sign in with." : "None."}
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {env.accounts.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                    <span className="font-semibold">{a.label}</span>
                    <span className="text-muted font-mono text-[13px]">{a.usernameHint}</span>
                    {a.isDefault && <Badge tone="info">Signs in</Badge>}
                  </span>
                  {canEdit && !a.isDefault && (
                    <Button size="sm" variant="ghost" onClick={() => void makeDefault(a.id)}>
                      Use to sign in
                    </Button>
                  )}
                  {canEdit && (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Remove ${a.label}`}
                      onClick={() => void removeAccount(a.id, a.label)}
                    >
                      Remove
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canEdit &&
            (addingAccount ? (
              <AccountForm
                url={`${apiBase}/${env.id}/accounts`}
                envId={env.id}
                onDone={(text) => {
                  setAddingAccount(false);
                  onMessage("success", text);
                }}
                onCancel={() => setAddingAccount(false)}
              />
            ) : (
              <Button
                size="sm"
                variant="secondary"
                className="self-start"
                onClick={() => setAddingAccount(true)}
              >
                <PlusIcon /> Add test account
              </Button>
            ))}
        </div>
        <div className="flex flex-col gap-2">
          <SectionLabel>Sign-in</SectionLabel>
          {env.loginConfig ? (
            <p className="text-[13px] leading-relaxed">
              Page <span className="font-mono">{env.loginConfig.path}</span> · fields “
              {env.loginConfig.usernameLabel}” and “{env.loginConfig.passwordLabel}” · button “
              {env.loginConfig.submitLabel}”
            </p>
          ) : (
            <p className="text-muted text-[13px]">No sign-in: tests start signed out.</p>
          )}
          <SectionLabel className="mt-2">Variables</SectionLabel>
          {env.variables.length ? (
            <ul className="flex flex-col gap-0.5 text-[13px]">
              {env.variables.map((v) => (
                <li key={v.name}>
                  <span className="font-mono">{v.name}</span>
                  <span className="text-muted"> = {v.value}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted text-[13px]">None.</p>
          )}
        </div>
      </div>
    </Card>
  );
}

function AccountForm({
  url,
  envId,
  onDone,
  onCancel,
}: {
  url: string;
  envId: string;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setPending(true);
    setError(null);
    try {
      await api(url, {
        json: { label: f.get("label"), username: f.get("username"), password: f.get("password") },
      });
      form.reset();
      onDone("Account saved (encrypted). Run the check again.");
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError("Couldn't save.", 0, "UNKNOWN"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={save}
      className="border-line flex flex-col gap-3 rounded-xl border p-3"
      autoComplete="off"
    >
      {error && <Alert tone="error">{error.message}</Alert>}
      <Field
        label="Label"
        htmlFor={`acc-label-${envId}`}
        hint="How scripts refer to it, e.g. Standard user"
      >
        <Input
          id={`acc-label-${envId}`}
          name="label"
          required
          maxLength={60}
          defaultValue="Standard user"
        />
      </Field>
      <Field label="Username" htmlFor={`acc-user-${envId}`}>
        <Input
          id={`acc-user-${envId}`}
          name="username"
          required
          maxLength={254}
          autoComplete="off"
        />
      </Field>
      <Field
        label="Password"
        htmlFor={`acc-pass-${envId}`}
        hint="Encrypted when saved. It's never shown again and never sent to the AI."
      >
        <Input
          id={`acc-pass-${envId}`}
          name="password"
          type="password"
          required
          maxLength={256}
          autoComplete="new-password"
        />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save account"}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
