"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRightIcon, DocumentIcon, PlusIcon } from "@/components/icons";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, Chip } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/states";
import { api, ApiError } from "@/lib/api-client";
import { REQUIREMENT_TYPE_LABELS, REQUIREMENT_TYPES, type RequirementTypeName } from "@/lib/domain";
import { plural } from "@/lib/format";
import {
  isJobActive,
  jobNote,
  type FlowItem,
  type JobItem,
  type QuestionItem,
  type RequirementItem,
} from "@/lib/types";
import { usePolling } from "@/lib/use-polling";
import { FlowsPanel } from "./flows-panel";
import { QuestionsPanel } from "./questions-panel";
import { ProgressBar } from "@/components/ui/progress-bar";

type Filter = "all" | "review" | "uncovered";

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
  const router = useRouter();
  const [requirements, setRequirements] = useState(initialRequirements);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<RequirementItem | "new" | null>(null);
  const [merging, setMerging] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [job, setJob] = useState(initialGenerationJob);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const base = `/api/projects/${projectId}`;
  const wasActive = useRef(isJobActive(initialGenerationJob));

  const reloadRequirements = useCallback(async () => {
    const res = await api<{ requirements: RequirementItem[] }>(`${base}/requirements`);
    setRequirements(res.requirements);
  }, [base]);

  const pollJob = useCallback(async () => {
    const { jobs } = await api<{ jobs: JobItem[] }>(`${base}/jobs?types=GENERATE_TEST_CASES`);
    setJob(jobs[0] ?? null);
  }, [base]);
  usePolling(pollJob, isJobActive(job), 2000);

  useEffect(() => {
    const active = isJobActive(job);
    if (wasActive.current && !active) {
      void reloadRequirements();
      router.refresh();
    }
    wasActive.current = active;
  }, [job, reloadRequirements, router]);

  const uncovered = requirements.filter((r) => r.testCaseCount === 0);
  const needsReview = requirements.filter((r) => r.status === "NEEDS_REVIEW");
  const shown =
    filter === "review" ? needsReview : filter === "uncovered" ? uncovered : requirements;

  function fail(err: unknown, fallback: string) {
    setMessage({ tone: "error", text: err instanceof ApiError ? err.message : fallback });
  }

  async function generate() {
    setMessage(null);
    try {
      const res = await api<{ job: JobItem }>(`${base}/test-cases/generate`, {
        json: selected.size > 0 ? { requirementIds: [...selected] } : {},
      });
      setJob(res.job);
      setSelected(new Set());
    } catch (err) {
      fail(err, "Couldn't start writing test cases.");
    }
  }

  async function remove(r: RequirementItem) {
    if (!window.confirm(`Remove ${r.key} from the scope? Linked test cases are kept.`)) return;
    try {
      await api(`${base}/requirements/${r.id}`, { method: "DELETE" });
      setRequirements((rs) => rs.filter((x) => x.id !== r.id));
    } catch (err) {
      fail(err, "Couldn't remove it.");
    }
  }

  async function markReviewed(r: RequirementItem) {
    try {
      await api(`${base}/requirements/${r.id}`, { method: "PATCH", json: { status: "ACTIVE" } });
      await reloadRequirements();
    } catch (err) {
      fail(err, "Couldn't update it.");
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

  const running = isJobActive(job);
  const { note } = jobNote(job);
  const result =
    job?.status === "SUCCEEDED" ? (job.result as Record<string, unknown> | null) : null;
  const notCovered = (result?.notCovered as { key: string; reason: string }[] | undefined) ?? [];
  const selectedReqs = requirements.filter((r) => selected.has(r.id));

  return (
    <div className="flex flex-wrap items-start gap-6">
      <section
        aria-labelledby="req-heading"
        className="flex min-w-0 flex-[999_1_560px] flex-col gap-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="req-heading" className="text-[19px] font-bold">
            Requirements ({requirements.length})
          </h2>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter requirements">
            <Chip active={filter === "all"} onClick={() => setFilter("all")}>
              All {requirements.length}
            </Chip>
            <Chip active={filter === "review"} onClick={() => setFilter("review")}>
              Needs review {needsReview.length}
            </Chip>
            <Chip active={filter === "uncovered"} onClick={() => setFilter("uncovered")}>
              No test cases {uncovered.length}
            </Chip>
          </div>
        </div>
        {message && <Alert tone={message.tone}>{message.text}</Alert>}

        {canWrite && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setEditing("new")}>
              <PlusIcon /> Add requirement
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={selected.size < 2}
              onClick={() => setMerging(true)}
            >
              Merge selected{selected.size >= 2 ? ` (${selected.size})` : ""}
            </Button>
            {selected.size > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                Clear selection
              </Button>
            )}
          </div>
        )}

        {requirements.length === 0 ? (
          <EmptyState
            icon={<DocumentIcon />}
            title="No requirements yet"
            description="Let the assistant read your files on the Upload step, or add requirements yourself."
            action={
              <Button asChild>
                <Link href={`/projects/${projectId}`}>Go to Upload</Link>
              </Button>
            }
          />
        ) : (
          <Card className="overflow-hidden">
            <ul>
              {shown.map((r) => (
                <li
                  key={r.id}
                  className="border-line-soft flex items-start gap-3 border-b px-5 py-4 last:border-b-0"
                >
                  {(canWrite || canRunAi) && (
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
                      <span className="text-ink-2 font-mono text-[13px] whitespace-nowrap">
                        {r.key}
                      </span>
                      <Badge>{REQUIREMENT_TYPE_LABELS[r.type] ?? r.type}</Badge>
                      {r.status === "NEEDS_REVIEW" && <Badge tone="warning">Needs review</Badge>}
                      {r.origin === "MANUAL" && <Badge tone="info">Added by tester</Badge>}
                    </div>
                    <p className="mt-1.5 leading-normal">{r.text}</p>
                    <div className="text-muted mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
                      {(r.sourceDocument || r.sourceSection) && (
                        <span>
                          Source:{" "}
                          {[r.sourceDocument?.originalName, r.sourceSection]
                            .filter(Boolean)
                            .join(", ")}
                        </span>
                      )}
                      <span
                        className={r.testCaseCount === 0 ? "text-warn font-semibold" : undefined}
                      >
                        {r.testCaseCount === 0
                          ? "No test cases yet"
                          : `${plural(r.testCaseCount, "test case")} · ${r.approvedTestCaseCount} approved`}
                      </span>
                      {r.updatedBy && <span>Last edited by {r.updatedBy.name}</span>}
                    </div>
                  </div>
                  {canWrite && (
                    <div className="flex shrink-0 flex-wrap justify-end gap-1">
                      {r.status === "NEEDS_REVIEW" && (
                        <Button variant="ghost" size="sm" onClick={() => void markReviewed(r)}>
                          Mark reviewed
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditing(r)}
                        aria-label={`Edit ${r.key}`}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void remove(r)}
                        aria-label={`Remove ${r.key}`}
                      >
                        Remove
                      </Button>
                    </div>
                  )}
                </li>
              ))}
              {shown.length === 0 && (
                <li className="text-muted px-5 py-8 text-center">Nothing here.</li>
              )}
            </ul>
          </Card>
        )}

        <QuestionsPanel
          projectId={projectId}
          initialQuestions={initialQuestions}
          requirements={requirements}
          canWrite={canWrite}
        />
        <FlowsPanel projectId={projectId} initialFlows={initialFlows} canWrite={canWrite} />
      </section>

      <aside className="flex min-w-0 flex-[1_1_320px] flex-col gap-4">
        <Card className="flex flex-col gap-3.5 p-5">
          <h2 className="text-[17px] font-bold">Write test cases</h2>
          <p className="text-muted text-[13px] leading-normal">
            The assistant writes positive, negative and boundary cases, grouped into scenarios. They
            start as drafts for you to review.{" "}
            {selected.size > 0
              ? `${plural(selected.size, "requirement")} selected.`
              : `Without a selection, it covers the ${plural(uncovered.length, "requirement")} that have no test cases.`}
          </p>
          {running ? (
            <div role="status" aria-live="polite" className="flex flex-col gap-2">
              <span className="text-sm font-semibold">
                {job?.status === "QUEUED" ? "Waiting to start…" : (note ?? "Writing test cases…")}
              </span>
              <ProgressBar
                value={job?.progress ?? 0}
                min={5}
                height="h-2.5"
                label="Test case writing progress"
              />
            </div>
          ) : job?.status === "FAILED" ? (
            <Alert tone="error">{job.error ?? "That didn't work. Please try again."}</Alert>
          ) : result ? (
            <Alert tone="success">
              Added {plural(Number(result.testCasesAdded ?? 0), "draft test case")}
              {Number(result.scenariosAdded ?? 0) > 0 &&
                ` in ${plural(Number(result.scenariosAdded), "new scenario")}`}
              .
            </Alert>
          ) : null}
          {notCovered.length > 0 && !running && (
            <div className="bg-warn-faint text-warn-ink rounded-xl p-3 text-[13px]">
              <p className="font-semibold">Not covered yet:</p>
              <ul className="mt-1 list-disc pl-5">
                {notCovered.map((n) => (
                  <li key={n.key}>
                    <span className="font-mono">{n.key}</span> — {n.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {canRunAi && (
            <Button
              onClick={() => void generate()}
              disabled={
                running ||
                requirements.length === 0 ||
                (selected.size === 0 && uncovered.length === 0)
              }
            >
              {selected.size > 0 ? "Write test cases for selected" : "Write test cases"}
            </Button>
          )}
          <Button variant="secondary" asChild>
            <Link href={`/projects/${projectId}/test-cases`}>
              Review test cases <ArrowRightIcon />
            </Link>
          </Button>
        </Card>
      </aside>

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
      {merging && (
        <MergeDialog
          projectId={projectId}
          requirements={selectedReqs}
          onClose={() => setMerging(false)}
          onMerged={(key) => {
            setMerging(false);
            setSelected(new Set());
            setMessage({
              tone: "success",
              text: `Merged into ${key}. Linked test cases and questions moved with it.`,
            });
            void reloadRequirements();
          }}
        />
      )}
    </div>
  );
}

function TypeSelect({ id, defaultValue }: { id: string; defaultValue: RequirementTypeName }) {
  return (
    <Select id={id} name="type" defaultValue={defaultValue}>
      {REQUIREMENT_TYPES.map((t) => (
        <option key={t} value={t}>
          {REQUIREMENT_TYPE_LABELS[t]}
        </option>
      ))}
    </Select>
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
            <TypeSelect id="req-type" defaultValue={requirement?.type ?? "FEATURE"} />
          </Field>
          <Field
            label="Section (optional)"
            htmlFor="req-section"
            hint="Where it comes from, e.g. “p. 4, 4.1 Leave request”."
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

/** FR-3.4: merge duplicates into one; the lowest-numbered one keeps its ID. */
function MergeDialog({
  projectId,
  requirements,
  onClose,
  onMerged,
}: {
  projectId: string;
  requirements: RequirementItem[];
  onClose: () => void;
  onMerged: (key: string) => void;
}) {
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);
  const sorted = [...requirements].sort((a, b) => a.key.localeCompare(b.key));
  const keeper = sorted[0];

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    try {
      const { requirement } = await api<{ requirement: { key: string } }>(
        `/api/projects/${projectId}/requirements/merge`,
        {
          json: {
            requirementIds: sorted.map((r) => r.id),
            text: f.get("text"),
            type: f.get("type"),
          },
        },
      );
      onMerged(requirement.key);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError("Couldn't merge.", 0, "UNKNOWN"));
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={`Merge ${requirements.length} requirements`}
        description={`They become one requirement, ${keeper?.key ?? ""}. Linked test cases and questions move to it.`}
      >
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {error && Object.keys(error.fieldErrors).length === 0 && (
            <Alert tone="error">{error.message}</Alert>
          )}
          <ul className="bg-page flex flex-col gap-1 rounded-xl p-3 text-[13px]">
            {sorted.map((r) => (
              <li key={r.id}>
                <span className="font-mono">{r.key}</span> {r.text}
              </li>
            ))}
          </ul>
          <Field
            label="Merged wording"
            htmlFor="merge-text"
            error={error?.fieldErrors["text"]?.[0]}
          >
            <Textarea
              id="merge-text"
              name="text"
              required
              maxLength={2000}
              defaultValue={sorted.map((r) => r.text).join(" ")}
            />
          </Field>
          <Field label="Type" htmlFor="merge-type">
            <TypeSelect id="merge-type" defaultValue={keeper?.type ?? "FEATURE"} />
          </Field>
          <Button type="submit" disabled={pending}>
            {pending ? "Merging…" : "Merge"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
