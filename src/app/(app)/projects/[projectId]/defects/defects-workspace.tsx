"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SEVERITY_LABEL } from "@/components/report/report-view";
import { Alert } from "@/components/ui/alert";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button, Chip } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/states";
import { api, ApiError } from "@/lib/api-client";
import { activityLabel } from "@/lib/format";
import type { DefectItem, DefectSeverityName, DefectStatusName } from "@/lib/types";

const SEVERITY_TONE: Record<DefectSeverityName, BadgeTone> = {
  CRITICAL: "danger",
  HIGH: "warning",
  MEDIUM: "info",
  LOW: "neutral",
};

type Filter = "ALL" | DefectStatusName;

export function DefectsWorkspace({
  projectId,
  defects,
  canWrite,
}: {
  projectId: string;
  defects: DefectItem[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("ALL");
  const [editing, setEditing] = useState<DefectItem | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const count = (f: Filter) =>
    f === "ALL" ? defects.length : defects.filter((d) => d.status === f).length;
  const shown = filter === "ALL" ? defects : defects.filter((d) => d.status === filter);

  async function setStatus(d: DefectItem, status: DefectStatusName) {
    setError(null);
    setBusy(d.id);
    try {
      await api(`/api/projects/${projectId}/defects/${d.id}`, {
        method: "PATCH",
        json: { status },
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update the defect.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="flex flex-col gap-4" aria-label="Defects">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter">
          {(
            [
              ["ALL", "All"],
              ["OPEN", "Open"],
              ["RESOLVED", "Resolved"],
            ] as const
          ).map(([f, label]) => (
            <Chip key={f} active={filter === f} onClick={() => setFilter(f)}>
              {label} {count(f)}
            </Chip>
          ))}
        </div>
        {canWrite && <Button onClick={() => setEditing("new")}>Log defect</Button>}
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {shown.length === 0 ? (
        <EmptyState
          title={defects.length === 0 ? "No defect logged yet" : "Nothing here"}
          description={
            defects.length === 0
              ? "When a test fails, open its run report and choose “Log defect”."
              : "No defect matches this filter."
          }
        />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {shown.map((d) => (
            <li
              key={d.id}
              id={d.key}
              className="rounded-card border-line target:ring-accent flex scroll-mt-6 flex-col gap-2 border bg-white p-[18px] target:ring-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted font-mono text-[13px]">{d.key}</span>
                <Badge tone={SEVERITY_TONE[d.severity]}>{SEVERITY_LABEL[d.severity]}</Badge>
                <Badge tone={d.status === "OPEN" ? "warning" : "success"}>
                  {d.status === "OPEN" ? "Open" : "Resolved"}
                </Badge>
                {d.testCase && (
                  <span className="text-muted font-mono text-[13px]">{d.testCase.key}</span>
                )}
              </div>
              <h3 className="text-base font-bold break-words">{d.title}</h3>
              {d.description && (
                <p className="text-ink-2 line-clamp-4 text-sm break-words whitespace-pre-wrap">
                  {d.description}
                </p>
              )}
              <div className="text-muted flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
                <span suppressHydrationWarning>
                  {activityLabel("Logged", d.createdAt)} by {d.createdBy.name}
                </span>
                {d.runTest && (
                  <Link href={`/projects/${projectId}/runs/${d.runTest.runId}/report`}>
                    See the run report
                  </Link>
                )}
                {d.externalUrl && (
                  <a href={d.externalUrl} target="_blank" rel="noopener noreferrer nofollow">
                    Open ticket
                  </a>
                )}
              </div>
              {canWrite && (
                <div className="mt-1 flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setEditing(d)}>
                    Edit
                  </Button>
                  {d.status === "OPEN" ? (
                    <Button
                      size="sm"
                      variant="soft"
                      disabled={busy === d.id}
                      onClick={() => void setStatus(d, "RESOLVED")}
                    >
                      Mark resolved
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy === d.id}
                      onClick={() => void setStatus(d, "OPEN")}
                    >
                      Reopen
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <DefectEditDialog
          projectId={projectId}
          defect={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </section>
  );
}

function DefectEditDialog({
  projectId,
  defect,
  onClose,
  onSaved,
}: {
  projectId: string;
  defect: DefectItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(defect?.title ?? "");
  const [severity, setSeverity] = useState<DefectSeverityName>(defect?.severity ?? "MEDIUM");
  const [description, setDescription] = useState(defect?.description ?? "");
  const [externalUrl, setExternalUrl] = useState(defect?.externalUrl ?? "");
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string[] | undefined>>({});
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setFields({});
    try {
      const json = { title, severity, description, externalUrl };
      if (defect) {
        await api(`/api/projects/${projectId}/defects/${defect.id}`, { method: "PATCH", json });
      } else {
        await api(`/api/projects/${projectId}/defects`, { json });
      }
      onSaved();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFields(err.fieldErrors);
      } else setError("Couldn't save the defect. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent wide title={defect ? `Edit ${defect.key}` : "Log a defect"}>
        <form className="flex flex-col gap-4" onSubmit={(e) => void save(e)}>
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="Title" htmlFor="d-title" error={fields.title?.[0]}>
            <Input
              id="d-title"
              value={title}
              maxLength={200}
              required
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field label="Severity" htmlFor="d-severity">
            <Select
              id="d-severity"
              value={severity}
              onChange={(e) => setSeverity(e.target.value as DefectSeverityName)}
            >
              {Object.entries(SEVERITY_LABEL).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Description" htmlFor="d-description" error={fields.description?.[0]}>
            <Textarea
              id="d-description"
              rows={8}
              value={description}
              maxLength={10_000}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <Field
            label="Link to the ticket (optional)"
            htmlFor="d-link"
            hint="If you also filed it in Jira, ClickUp or another tracker."
            error={fields.externalUrl?.[0]}
          >
            <Input
              id="d-link"
              type="url"
              placeholder="https://"
              value={externalUrl}
              onChange={(e) => setExternalUrl(e.target.value)}
            />
          </Field>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !title.trim()}>
              {saving ? "Saving…" : defect ? "Save changes" : "Log defect"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
