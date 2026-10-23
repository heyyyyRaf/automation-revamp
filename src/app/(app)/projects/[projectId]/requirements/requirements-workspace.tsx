"use client";

import { ArrowRight, FileText, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { JobProgress, resultNumber } from "@/components/job-progress";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/states";
import { api, ApiError } from "@/lib/api-client";
import {
  isJobActive,
  REQUIREMENT_TYPE_LABELS,
  type FlowItem,
  type JobItem,
  type QuestionItem,
  type RequirementItem,
} from "@/lib/types";
import { usePolling } from "@/lib/use-polling";
import { REQUIREMENT_TYPE_VALUES } from "@/lib/validation";
import { FlowsPanel } from "./flows-panel";
import { QuestionsPanel } from "./questions-panel";

export function RequirementsWorkspace({
  projectId,
  initialRequirements,
  initialFlows,
  initialQuestions,
  initialGenerationJob,
  canWrite,
  canRunAi,
}: {
  projectId: string;
  initialRequirements: RequirementItem[];
  initialFlows: FlowItem[];
  initialQuestions: QuestionItem[];
  initialGenerationJob: JobItem | null;
  canWrite: boolean;
  canRunAi: boolean;
}) {
  const [requirements, setRequirements] = useState(initialRequirements);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<RequirementItem | "new" | null>(null);
  const [job, setJob] = useState(initialGenerationJob);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const base = `/api/projects/${projectId}`;

  const reloadRequirements = useCallback(async () => {
    const res = await api<{ requirements: RequirementItem[] }>(`${base}/requirements`);
    setRequirements(res.requirements);
  }, [base]);

  const pollJob = useCallback(async () => {
    const { jobs } = await api<{ jobs: JobItem[] }>(`${base}/jobs?types=GENERATE_TEST_CASES`);
    const latest = jobs[0] ?? null;
    setJob(latest);
    if (latest && !isJobActive(latest)) await reloadRequirements();
  }, [base, reloadRequirements]);
  usePolling(pollJob, isJobActive(job));

  const uncovered = requirements.filter((r) => r.testCaseCount === 0).length;

  async function generate() {
    setMessage(null);
    try {
      const res = await api<{ job: JobItem }>(`${base}/test-cases/generate`, {
        json: selected.size > 0 ? { requirementIds: [...selected] } : {},
      });
      setJob(res.job);
      setSelected(new Set());
    } catch (err) {
      setMessage({
        tone: "error",
        text: err instanceof ApiError ? err.message : "Couldn't start generation.",
      });
    }
  }

  async function remove(r: RequirementItem) {
    if (!window.confirm(`Remove ${r.key} from the scope? Linked test cases are kept.`)) return;
    try {
      await api(`${base}/requirements/${r.id}`, { method: "DELETE" });
      setRequirements((rs) => rs.filter((x) => x.id !== r.id));
    } catch (err) {
      setMessage({
        tone: "error",
        text: err instanceof ApiError ? err.message : "Couldn't remove it.",
      });
    }
  }

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {message && <Alert tone={message.tone}>{message.text}</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>Step 3 · Generate test cases</CardTitle>
          <CardDescription>
            AI writes positive, negative and boundary test cases. They start as drafts for you to
            review.{" "}
            {selected.size > 0
              ? `${selected.size} requirement${selected.size === 1 ? "" : "s"} selected.`
              : `Without a selection, only the ${uncovered} requirement${uncovered === 1 ? "" : "s"} with no test cases are used.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="lg"
              onClick={() => void generate()}
              disabled={
                !canRunAi ||
                isJobActive(job) ||
                requirements.length === 0 ||
                (selected.size === 0 && uncovered === 0)
              }
            >
              <Sparkles aria-hidden /> Generate test cases
            </Button>
            <Button size="lg" variant="secondary" asChild>
              <Link href={`/projects/${projectId}/test-cases`}>
                Review test cases <ArrowRight aria-hidden />
              </Link>
            </Button>
          </div>
          <JobProgress
            job={job}
            runningLabel="Writing test cases… this can take a few minutes."
            doneLabel={(j) => `Done: ${resultNumber(j, "testCasesAdded")} new draft test cases.`}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Requirements ({requirements.length})</CardTitle>
            <CardDescription>
              Edit the wording, fix the type, or add anything the AI missed.
            </CardDescription>
          </div>
          {canWrite && (
            <Button variant="secondary" onClick={() => setEditing("new")}>
              <Plus aria-hidden /> Add requirement
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {requirements.length === 0 ? (
            <EmptyState
              icon={<FileText />}
              title="No requirements yet"
              description="Run the AI analysis on the Upload & analysis step, or add requirements yourself."
              action={
                <Button asChild>
                  <Link href={`/projects/${projectId}`}>Go to Upload & analysis</Link>
                </Button>
              }
            />
          ) : (
            <ul className="divide-y divide-slate-100">
              {requirements.map((r) => (
                <li key={r.id} className="flex items-start gap-3 py-3">
                  {canRunAi && (
                    <input
                      type="checkbox"
                      className="accent-accent mt-1 size-5"
                      checked={selected.has(r.id)}
                      onChange={() => toggle(r.id)}
                      aria-label={`Select ${r.key}`}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-slate-700">
                        {r.key}
                      </span>
                      <Badge>{REQUIREMENT_TYPE_LABELS[r.type] ?? r.type}</Badge>
                      {r.origin === "MANUAL" && <Badge tone="info">Added by tester</Badge>}
                      <Badge
                        tone={
                          r.approvedTestCaseCount > 0
                            ? "success"
                            : r.testCaseCount > 0
                              ? "warning"
                              : "danger"
                        }
                      >
                        {r.testCaseCount === 0
                          ? "No test cases"
                          : `${r.testCaseCount} test case${r.testCaseCount === 1 ? "" : "s"} (${r.approvedTestCaseCount} approved)`}
                      </Badge>
                    </div>
                    <p className="mt-1 text-slate-900">{r.text}</p>
                    {(r.sourceDocument || r.sourceSection) && (
                      <p className="mt-0.5 text-sm text-slate-500">
                        Source:{" "}
                        {[r.sourceDocument?.originalName, r.sourceSection]
                          .filter(Boolean)
                          .join(" — ")}
                      </p>
                    )}
                  </div>
                  {canWrite && (
                    <div className="flex shrink-0 gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditing(r)}
                        aria-label={`Edit ${r.key}`}
                      >
                        <Pencil aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void remove(r)}
                        aria-label={`Remove ${r.key}`}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <QuestionsPanel
        projectId={projectId}
        initialQuestions={initialQuestions}
        requirements={requirements}
        canWrite={canWrite}
      />
      <FlowsPanel projectId={projectId} initialFlows={initialFlows} canWrite={canWrite} />

      {editing && (
        <RequirementDialog
          projectId={projectId}
          requirement={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void reloadRequirements();
          }}
        />
      )}
    </div>
  );
}

function RequirementDialog({
  projectId,
  requirement,
  onClose,
  onSaved,
}: {
  projectId: string;
  requirement: RequirementItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = {
      text: f.get("text"),
      type: f.get("type"),
      sourceSection: String(f.get("sourceSection") ?? "") || null,
    };
    setPending(true);
    setError(null);
    try {
      await api(
        requirement
          ? `/api/projects/${projectId}/requirements/${requirement.id}`
          : `/api/projects/${projectId}/requirements`,
        { method: requirement ? "PATCH" : "POST", json: body },
      );
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError("Couldn't save.", 0, "UNKNOWN"));
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={requirement ? `Edit ${requirement.key}` : "Add a requirement"}>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {error && Object.keys(error.fieldErrors).length === 0 && (
            <Alert tone="error">{error.message}</Alert>
          )}
          <Field
            label="Requirement"
            htmlFor="req-text"
            hint="One testable behaviour."
            error={error?.fieldErrors["text"]?.[0]}
          >
            <Textarea
              id="req-text"
              name="text"
              required
              maxLength={2000}
              defaultValue={requirement?.text ?? ""}
            />
          </Field>
          <Field label="Type" htmlFor="req-type">
            <Select id="req-type" name="type" defaultValue={requirement?.type ?? "FUNCTIONAL"}>
              {REQUIREMENT_TYPE_VALUES.map((t) => (
                <option key={t} value={t}>
                  {REQUIREMENT_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Section (optional)"
            htmlFor="req-section"
            hint="Where it comes from, e.g. “3.2 Checkout”."
          >
            <Input
              id="req-section"
              name="sourceSection"
              maxLength={200}
              defaultValue={requirement?.sourceSection ?? ""}
            />
          </Field>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save requirement"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
