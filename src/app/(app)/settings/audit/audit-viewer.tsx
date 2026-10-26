"use client";

import { Fragment, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/states";
import { api, ApiError } from "@/lib/api-client";
import type { AuditEntryItem } from "@/lib/types";

const FAMILIES: [string, string][] = [
  ["auth", "Sign-ins"],
  ["user", "Users"],
  ["project", "Projects"],
  ["member", "Project members"],
  ["document", "Documents"],
  ["ai", "AI jobs"],
  ["requirement", "Requirements"],
  ["scenario", "Scenarios"],
  ["question", "Questions"],
  ["testcase", "Test cases"],
  ["comment", "Comments"],
  ["export", "Exports"],
  ["target", "Approved addresses"],
  ["environment", "Environments"],
  ["account", "Test accounts"],
  ["script", "Scripts"],
  ["run", "Runs"],
  ["defect", "Defects"],
  ["report", "Report links"],
  ["settings", "Settings"],
];

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" });

type Page = { entries: AuditEntryItem[]; nextCursor: string | null };

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "object" && Object.keys(v).length === 0);
}

function Json({ label, value }: { label: string; value: unknown }) {
  if (isEmpty(value)) return null;
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-muted text-xs font-bold tracking-[0.04em] uppercase">{label}</span>
      <pre className="bg-page m-0 overflow-x-auto rounded-lg p-2.5 font-mono text-xs break-words whitespace-pre-wrap">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

export function AuditViewer({
  initial,
  projects,
  users,
}: {
  initial: Page;
  projects: { id: string; name: string }[];
  users: { id: string; name: string }[];
}) {
  const [filters, setFilters] = useState({ projectId: "", actorId: "", action: "" });
  const [entries, setEntries] = useState(initial.entries);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load(next: typeof filters, after: string | null) {
    setLoading(true);
    setError(null);
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v) q.set(k, v);
    if (after) q.set("cursor", after);
    try {
      const page = await api<Page>(`/api/admin/audit?${q.toString()}`);
      setEntries((cur) => (after ? [...cur, ...page.entries] : page.entries));
      setCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load the audit log.");
    } finally {
      setLoading(false);
    }
  }

  function change(key: keyof typeof filters, value: string) {
    const next = { ...filters, [key]: value };
    setFilters(next);
    void load(next, null);
  }

  return (
    <section className="flex flex-col gap-4" aria-label="Audit entries">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Project" htmlFor="audit-project">
          <Select
            id="audit-project"
            value={filters.projectId}
            onChange={(e) => change("projectId", e.target.value)}
          >
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Person" htmlFor="audit-actor">
          <Select
            id="audit-actor"
            value={filters.actorId}
            onChange={(e) => change("actorId", e.target.value)}
          >
            <option value="">Everyone</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Kind of change" htmlFor="audit-action">
          <Select
            id="audit-action"
            value={filters.action}
            onChange={(e) => change("action", e.target.value)}
          >
            <option value="">Everything</option>
            {FAMILIES.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {entries.length === 0 ? (
        <EmptyState title="Nothing logged" description="No entry matches these filters." />
      ) : (
        <div className="border-line rounded-card overflow-x-auto border bg-white">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="text-muted text-left text-xs tracking-[0.04em] uppercase">
                <th className="px-4 py-3 font-semibold">When</th>
                <th className="px-2 py-3 font-semibold">Who</th>
                <th className="px-2 py-3 font-semibold">What</th>
                <th className="px-2 py-3 font-semibold">Project</th>
                <th className="px-4 py-3 font-semibold">
                  <span className="sr-only">Details</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const hasDetails = !isEmpty(e.before) || !isEmpty(e.after) || !isEmpty(e.metadata);
                return (
                  <Fragment key={e.id}>
                    <tr className="border-line-soft border-t align-top">
                      <td
                        className="text-muted px-4 py-2.5 text-[13px] whitespace-nowrap"
                        suppressHydrationWarning
                      >
                        {when.format(new Date(e.createdAt))}
                      </td>
                      <td className="px-2 py-2.5">
                        {e.actor?.name ?? <span className="text-muted">System or guest</span>}
                      </td>
                      <td className="px-2 py-2.5">
                        <span className="font-mono text-[12.5px]">{e.action}</span>
                        <span className="text-muted text-[13px]"> · {e.entityType}</span>
                      </td>
                      <td className="text-ink-2 px-2 py-2.5 text-[13px]">
                        {e.project?.name ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {hasDetails && (
                          <button
                            type="button"
                            className="text-link text-[13px] font-semibold hover:underline"
                            aria-expanded={open === e.id}
                            onClick={() => setOpen(open === e.id ? null : e.id)}
                          >
                            {open === e.id ? "Hide" : "Details"}
                          </button>
                        )}
                      </td>
                    </tr>
                    {open === e.id && (
                      <tr className="bg-accent-faint">
                        <td colSpan={5} className="px-4 py-3">
                          <div className="flex flex-wrap gap-3">
                            <Json label="Before" value={e.before} />
                            <Json label="After" value={e.after} />
                            <Json label="Details" value={e.metadata} />
                          </div>
                          {e.ipAddress && (
                            <p className="text-muted mt-2 text-xs">From {e.ipAddress}</p>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {cursor && (
        <Button
          variant="secondary"
          className="self-start"
          disabled={loading}
          onClick={() => void load(filters, cursor)}
        >
          {loading ? "Loading…" : "Load more"}
        </Button>
      )}
    </section>
  );
}
