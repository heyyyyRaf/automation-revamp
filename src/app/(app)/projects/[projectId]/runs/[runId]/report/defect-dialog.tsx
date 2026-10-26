"use client";

import { useState } from "react";
import { CAUSE_LABEL, SEVERITY_LABEL } from "@/components/report/report-view";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { api, ApiError } from "@/lib/api-client";
import type { DefectSeverityName, ReportFailure } from "@/lib/types";

function draftDescription(f: ReportFailure): string {
  return [
    `Test case: ${f.key} ${f.title}`,
    f.requirementKeys.length ? `Requirements: ${f.requirementKeys.join(", ")}` : "",
    `Result: ${f.status === "ERROR" ? "Error" : "Failed"}`,
    f.error ? `\nWhat happened:\n${f.error}` : "",
    f.likelyCause
      ? `\nLikely cause: ${CAUSE_LABEL[f.likelyCause]}${f.causeExplanation ? ` — ${f.causeExplanation}` : ""}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** FRD step 7: "A failed case can be logged as a defect (manually in v1)". */
export function DefectDialog({
  projectId,
  failure,
  onClose,
  onSaved,
}: {
  projectId: string;
  failure: ReportFailure;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(failure.title);
  const [severity, setSeverity] = useState<DefectSeverityName>(
    failure.likelyCause === "APP_BUG" ? "HIGH" : "MEDIUM",
  );
  const [description, setDescription] = useState(() => draftDescription(failure));
  const [externalUrl, setExternalUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string[] | undefined>>({});
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setFields({});
    try {
      await api(`/api/projects/${projectId}/defects`, {
        json: { title, severity, description, externalUrl, runTestId: failure.runTestId },
      });
      onSaved();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFields(err.fieldErrors);
      } else setError("Couldn't log the defect. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        wide
        title={`Log a defect for ${failure.key}`}
        description="It's kept with this project and linked to the failed result."
      >
        <form className="flex flex-col gap-4" onSubmit={(e) => void save(e)}>
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="Title" htmlFor="defect-title" error={fields.title?.[0]}>
            <Input
              id="defect-title"
              value={title}
              maxLength={200}
              required
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field label="Severity" htmlFor="defect-severity">
            <Select
              id="defect-severity"
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
          <Field label="Description" htmlFor="defect-description" error={fields.description?.[0]}>
            <Textarea
              id="defect-description"
              rows={9}
              value={description}
              maxLength={10_000}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <Field
            label="Link to the ticket (optional)"
            htmlFor="defect-link"
            hint="If you also filed it in Jira, ClickUp or another tracker."
            error={fields.externalUrl?.[0]}
          >
            <Input
              id="defect-link"
              type="url"
              inputMode="url"
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
              {saving ? "Saving…" : "Log defect"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
