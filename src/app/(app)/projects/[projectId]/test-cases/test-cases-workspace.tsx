"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRightIcon, DownloadIcon, InfoIcon, ListIcon, PlusIcon } from "@/components/icons";
import { PageHeader } from "@/components/project/page-header";
import { Alert } from "@/components/ui/alert";
import { Badge, StatusDot, type BadgeTone } from "@/components/ui/badge";
import { Button, Chip } from "@/components/ui/button";
import { Card, SectionLabel } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/states";
import { api, ApiError } from "@/lib/api-client";
import {
  TEST_CASE_STATUS_LABELS,
  TEST_CASE_TYPE_LABELS,
  type TestCaseStatusName,
  type TestCaseTypeName,
} from "@/lib/domain";
import { activityLabel, plural } from "@/lib/format";
import {
  isJobActive,
  type CommentItem,
  type JobItem,
  type ScenarioItem,
  type TestCaseItem,
} from "@/lib/types";
import { usePolling } from "@/lib/use-polling";
import { cn } from "@/lib/utils";
import { TestScopeCard } from "../assistant-panel";
import { TestCaseDialog, type RequirementOption } from "./test-case-dialog";

const TYPE_TONE: Record<TestCaseTypeName, BadgeTone> = {
  POSITIVE: "success",
  NEGATIVE: "warning",
  BOUNDARY: "purple",
};

const STATUS_COLOR: Record<TestCaseStatusName, string> = {
  DRAFT: "text-muted",
  APPROVED: "text-success",
  REJECTED: "text-warn",
  SCRIPTED: "text-purple",
  PASSED: "text-success",
  FAILED: "text-warn",
  ERROR: "text-warn",
};

type TypeFilter = "ALL" | TestCaseTypeName | "MANUAL";

function TypeBadge({ tc }: { tc: Pick<TestCaseItem, "type" | "automatable"> }) {
  return tc.automatable ? (
    <Badge tone={TYPE_TONE[tc.type]}>{TEST_CASE_TYPE_LABELS[tc.type]}</Badge>
  ) : (
    <Badge>Manual-only</Badge>
  );
}

/** Design: "Review test cases" — table on the left, the selected case on the right. */
export function TestCasesWorkspace({
  projectId,
  projectName,
  archived,
  requirementCount,
  initialTestCases,
  scenarios,
  requirements,
  canWrite,
  canReview,
  canRunAi,
  canComment,
  canExport,
}: {
  projectId: string;
  projectName: string;
  archived: boolean;
  requirementCount: number;
  initialTestCases: TestCaseItem[];
  scenarios: ScenarioItem[];
  requirements: RequirementOption[];
  canWrite: boolean;
  canReview: boolean;
  canRunAi: boolean;
  canComment: boolean;
  canExport: boolean;
}) {
  const router = useRouter();
  const [testCases, setTestCases] = useState(initialTestCases);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | TestCaseStatusName>("ALL");
  const [scenarioFilter, setScenarioFilter] = useState("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(initialTestCases[0]?.id ?? null);
  const [editing, setEditing] = useState<TestCaseItem | "new" | null>(null);
  const [rejecting, setRejecting] = useState<string[] | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const base = `/api/projects/${projectId}/test-cases`;

  const reload = useCallback(async () => {
    const res = await api<{ testCases: TestCaseItem[] }>(base);
    setTestCases(res.testCases);
  }, [base]);

  const counts = useMemo(() => {
    const live = testCases.filter((t) => statusFilter === "ALL" || t.status === statusFilter);
    return {
      ALL: live.length,
      POSITIVE: live.filter((t) => t.automatable && t.type === "POSITIVE").length,
      NEGATIVE: live.filter((t) => t.automatable && t.type === "NEGATIVE").length,
      BOUNDARY: live.filter((t) => t.automatable && t.type === "BOUNDARY").length,
      MANUAL: live.filter((t) => !t.automatable).length,
    };
  }, [testCases, statusFilter]);

  const shown = testCases.filter(
    (t) =>
      (statusFilter === "ALL" || t.status === statusFilter) &&
      (scenarioFilter === "ALL" || t.scenario?.id === scenarioFilter) &&
      (typeFilter === "ALL" ||
        (typeFilter === "MANUAL" ? !t.automatable : t.automatable && t.type === typeFilter)),
  );
  const selected = testCases.find((t) => t.id === selectedId) ?? shown[0] ?? null;
  const live = testCases.filter((t) => t.status !== "REJECTED");
  const approved = testCases.filter((t) => t.status !== "DRAFT" && t.status !== "REJECTED").length;
  const rejectedCount = testCases.filter((t) => t.status === "REJECTED").length;
  const shownDrafts = shown.filter((t) => t.status === "DRAFT");

  async function review(ids: string[], decision: "APPROVE" | "REJECT" | "REOPEN", reason?: string) {
    setMessage(null);
    try {
      const res = await api<{ updated: number }>(`${base}/review`, {
        json: { testCaseIds: ids, decision, ...(reason ? { reason } : {}) },
      });
      const verb =
        decision === "APPROVE"
          ? "approved"
          : decision === "REJECT"
            ? "rejected"
            : "moved back to Draft";
      setMessage({ tone: "success", text: `${plural(res.updated, "test case")} ${verb}.` });
      await reload();
      router.refresh();
    } catch (err) {
      setMessage({
        tone: "error",
        text: err instanceof ApiError ? err.message : "Couldn't save the review.",
      });
    }
  }

  async function approveAllShown() {
    if (shownDrafts.length === 0) return;
    if (!window.confirm(`Approve ${plural(shownDrafts.length, "draft test case")} shown here?`))
      return;
    await review(
      shownDrafts.map((t) => t.id),
      "APPROVE",
    );
  }

  async function regenerateRejected() {
    setMessage(null);
    try {
      await api(`${base}/regenerate`, { json: {} });
      setMessage({
        tone: "success",
        text: "The assistant is writing replacements for the rejected cases. They appear here as drafts when ready.",
      });
    } catch (err) {
      setMessage({
        tone: "error",
        text: err instanceof ApiError ? err.message : "Couldn't start.",
      });
    }
  }

  async function remove(tc: TestCaseItem) {
    if (!window.confirm(`Delete ${tc.key}? This can't be undone.`)) return;
    try {
      await api(`${base}/${tc.id}`, { method: "DELETE" });
      setSelectedId(null);
      await reload();
      router.refresh();
    } catch (err) {
      setMessage({
        tone: "error",
        text: err instanceof ApiError ? err.message : "Couldn't delete it.",
      });
    }
  }

  return (
    <>
      <PageHeader
        crumbs={[
          { label: "Projects", href: "/projects" },
          { label: projectName, href: `/projects/${projectId}` },
          { label: "Test cases" },
        ]}
        title="Review test cases"
        archived={archived}
        subtitle={`${plural(live.length, "case")} drafted from ${plural(requirementCount, "requirement")} · ${approved} approved`}
        actions={
          <>
            {canReview && (
              <Button
                variant="secondary"
                disabled={shownDrafts.length === 0}
                onClick={() => void approveAllShown()}
              >
                Approve all shown
              </Button>
            )}
            <Button variant="secondary" onClick={() => setDownloading(true)}>
              <DownloadIcon /> Download
            </Button>
            <Button asChild>
              <Link href={`/projects/${projectId}/scripts`}>
                Generate and review scripts <ArrowRightIcon />
              </Link>
            </Button>
          </>
        }
      />

      <div className="bg-accent-soft text-accent-strong flex items-center gap-3.5 rounded-xl px-[18px] py-3.5">
        <InfoIcon size={22} className="shrink-0" />
        <p className="text-sm leading-normal">
          These are drafts. Nothing runs against the app until you approve it — edit anything that
          looks off.
        </p>
      </div>

      {message && <Alert tone={message.tone}>{message.text}</Alert>}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by type">
          {(
            [
              ["ALL", "All"],
              ["POSITIVE", "Positive"],
              ["NEGATIVE", "Negative"],
              ["BOUNDARY", "Boundary"],
              ["MANUAL", "Manual-only"],
            ] as const
          ).map(([key, label]) => (
            <Chip key={key} active={typeFilter === key} onClick={() => setTypeFilter(key)}>
              {label} {counts[key]}
            </Chip>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <label htmlFor="status-filter" className="sr-only">
            Status
          </label>
          <Select
            id="status-filter"
            className="min-h-9 w-auto text-[13px]"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          >
            <option value="ALL">All statuses</option>
            {(Object.keys(TEST_CASE_STATUS_LABELS) as TestCaseStatusName[]).map((s) => (
              <option key={s} value={s}>
                {TEST_CASE_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
          <label htmlFor="scenario-filter" className="sr-only">
            Scenario
          </label>
          <Select
            id="scenario-filter"
            className="min-h-9 w-auto max-w-56 text-[13px]"
            value={scenarioFilter}
            onChange={(e) => setScenarioFilter(e.target.value)}
          >
            <option value="ALL">All scenarios</option>
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.key} {s.title}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {(canWrite || canRunAi) && (
        <div className="flex flex-wrap gap-2">
          {canWrite && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setEditing("new")}
              disabled={requirements.length === 0}
            >
              <PlusIcon /> New test case
            </Button>
          )}
          {canRunAi && (
            <Button variant="secondary" size="sm" asChild>
              <Link href={`/projects/${projectId}/requirements`}>
                Write more with the assistant
              </Link>
            </Button>
          )}
          {canRunAi && rejectedCount > 0 && (
            <Button variant="secondary" size="sm" onClick={() => void regenerateRejected()}>
              Rewrite rejected cases ({rejectedCount})
            </Button>
          )}
        </div>
      )}

      {testCases.length === 0 ? (
        <EmptyState
          icon={<ListIcon />}
          title="No test cases yet"
          description="Let the assistant write them from your requirements, or add them by hand."
          action={
            <Button asChild>
              <Link href={`/projects/${projectId}/requirements`}>Go to requirements</Link>
            </Button>
          }
        />
      ) : (
        <div className="flex flex-wrap items-start gap-6">
          <section
            aria-label="Test case list"
            className="rounded-card border-line relative min-w-0 flex-[999_1_560px] overflow-x-auto border bg-white"
          >
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="text-muted text-left text-xs tracking-[0.04em] uppercase">
                  <th className="px-4 py-3.5 font-semibold">ID</th>
                  <th className="px-2 py-3.5 font-semibold">Test case</th>
                  <th className="px-2 py-3.5 font-semibold">Type</th>
                  <th className="px-2 py-3.5 font-semibold">Requirement</th>
                  <th className="px-4 py-3.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((t) => (
                  <tr
                    key={t.id}
                    className={cn(
                      "border-line-soft border-t",
                      selected?.id === t.id ? "bg-[#F5F8FF]" : "bg-white",
                    )}
                  >
                    <td className="text-ink-2 px-4 py-3.5 font-mono text-[13px] whitespace-nowrap">
                      {t.key}
                    </td>
                    <td className="px-2 py-3.5">
                      <button
                        type="button"
                        onClick={() => setSelectedId(t.id)}
                        aria-pressed={selected?.id === t.id}
                        className="text-ink focus-visible:ring-accent cursor-pointer text-left font-semibold hover:underline focus-visible:ring-2 focus-visible:outline-none"
                      >
                        {t.title}
                      </button>
                    </td>
                    <td className="px-2 py-3.5">
                      <TypeBadge tc={t} />
                    </td>
                    <td className="text-muted px-2 py-3.5 font-mono text-[13px]">
                      {t.requirements.length === 0
                        ? "—"
                        : t.requirements.map((r, i) => (
                            <span key={r.id} className="whitespace-nowrap">
                              {r.key}
                              {i < t.requirements.length - 1 ? ", " : ""}
                            </span>
                          ))}
                    </td>
                    <td className="px-4 py-3.5">
                      <StatusDot
                        label={TEST_CASE_STATUS_LABELS[t.status]}
                        color={STATUS_COLOR[t.status]}
                      />
                    </td>
                  </tr>
                ))}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-muted px-4 py-10 text-center">
                      No test cases match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          {selected && (
            <CaseDetail
              key={selected.id}
              projectId={projectId}
              tc={selected}
              canWrite={canWrite}
              canReview={canReview}
              canRunAi={canRunAi}
              canComment={canComment}
              onApprove={() => void review([selected.id], "APPROVE")}
              onReject={() => setRejecting([selected.id])}
              onReopen={() => void review([selected.id], "REOPEN")}
              onEdit={() => setEditing(selected)}
              onDelete={() => void remove(selected)}
              onChanged={async (text) => {
                setMessage({ tone: "success", text });
                await reload();
                router.refresh();
              }}
            />
          )}
        </div>
      )}

      {editing && (
        <TestCaseDialog
          projectId={projectId}
          testCase={editing === "new" ? null : editing}
          requirements={requirements}
          scenarios={scenarios}
          onClose={() => setEditing(null)}
          onSaved={(text, id) => {
            setEditing(null);
            setMessage({ tone: "success", text });
            if (id) setSelectedId(id);
            void reload();
            router.refresh();
          }}
        />
      )}
      {rejecting && (
        <RejectDialog
          count={rejecting.length}
          onClose={() => setRejecting(null)}
          onConfirm={(reason) => {
            const ids = rejecting;
            setRejecting(null);
            void review(ids, "REJECT", reason);
          }}
        />
      )}
      {downloading && (
        <DownloadDialog
          projectId={projectId}
          requirementCount={requirementCount}
          canExport={canExport}
          filterQuery={new URLSearchParams({
            ...(statusFilter !== "ALL" ? { status: statusFilter } : {}),
            ...(scenarioFilter !== "ALL" ? { scenarioId: scenarioFilter } : {}),
            ...(typeFilter === "MANUAL"
              ? { manual: "1" }
              : typeFilter !== "ALL"
                ? { type: typeFilter }
                : {}),
          }).toString()}
          onClose={() => setDownloading(false)}
        />
      )}
    </>
  );
}

function CaseDetail({
  projectId,
  tc,
  canWrite,
  canReview,
  canRunAi,
  canComment,
  onApprove,
  onReject,
  onReopen,
  onEdit,
  onDelete,
  onChanged,
}: {
  projectId: string;
  tc: TestCaseItem;
  canWrite: boolean;
  canReview: boolean;
  canRunAi: boolean;
  canComment: boolean;
  onApprove: () => void;
  onReject: () => void;
  onReopen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onChanged: (message: string) => Promise<void>;
}) {
  const [rewriting, setRewriting] = useState(false);
  const source = tc.sources
    .map((s) => (s.section ? `${s.document}, ${s.section}` : s.document))
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(" · ");

  return (
    <aside
      aria-label="Selected test case"
      className="rounded-card border-line flex min-w-0 flex-[1_1_340px] flex-col gap-4 border bg-white p-[22px]"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted font-mono text-[13px]">
          {tc.key} · {tc.requirements.map((r) => r.key).join(", ") || "no requirement"}
        </span>
        <TypeBadge tc={tc} />
      </div>
      <h2 className="text-[19px] leading-snug font-bold">{tc.title}</h2>
      <div className="text-muted flex flex-wrap items-center gap-2 text-[13px]">
        <StatusDot label={TEST_CASE_STATUS_LABELS[tc.status]} color={STATUS_COLOR[tc.status]} />
        {tc.scenario && (
          <span>
            · Scenario <span className="font-mono">{tc.scenario.key}</span> {tc.scenario.title}
          </span>
        )}
        <span>· {tc.priority.charAt(0) + tc.priority.slice(1).toLowerCase()} priority</span>
      </div>
      {tc.status === "REJECTED" && tc.rejectionReason && (
        <Alert tone="error" title="Rejected">
          {tc.rejectionReason}
        </Alert>
      )}

      <div className="flex flex-col gap-1.5">
        <SectionLabel>Preconditions</SectionLabel>
        <p className="text-sm leading-relaxed">{tc.preconditions || "None"}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <SectionLabel>Steps</SectionLabel>
        <ol className="m-0 list-decimal pl-5 text-sm leading-relaxed">
          {tc.steps.map((s, i) => (
            <li key={i}>
              {s.action}
              {s.expected && <span className="text-muted"> → {s.expected}</span>}
            </li>
          ))}
        </ol>
      </div>
      {tc.testData.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <SectionLabel>Test data</SectionLabel>
          <ul className="m-0 flex flex-col gap-0.5 text-sm">
            {tc.testData.map((d) => (
              <li key={d.name}>
                <span className="text-muted">{d.name}:</span>{" "}
                <span className="font-mono text-[13px]">{d.value}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <SectionLabel>Expected result</SectionLabel>
        <p className="bg-page rounded-[10px] p-3 text-sm leading-relaxed">{tc.expectedResult}</p>
      </div>
      <p className="text-muted text-[13px]">
        <span className="text-ink-2 font-semibold">
          {tc.automatable ? "Automatable" : "Manual-only"}:
        </span>{" "}
        {tc.automatableReason}
      </p>
      {tc.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tc.tags.map((t) => (
            <Badge key={t}>#{t}</Badge>
          ))}
        </div>
      )}
      <p className="text-muted text-xs">Source: {source || "added by a tester"}</p>
      {(tc.reviewedBy || tc.updatedBy) && (
        <p className="text-muted text-xs" suppressHydrationWarning>
          {tc.reviewedBy && tc.reviewedAt
            ? `${tc.status === "REJECTED" ? "Rejected" : "Reviewed"} by ${tc.reviewedBy} · ${activityLabel("", tc.reviewedAt).trim()}`
            : tc.updatedBy
              ? `Last edited by ${tc.updatedBy}`
              : null}
        </p>
      )}

      {(canReview || canWrite) && (
        <div className="border-line-soft flex flex-wrap gap-2 border-t pt-4">
          {canReview && tc.status === "DRAFT" && (
            <Button className="flex-[1_1_120px]" onClick={onApprove}>
              Approve
            </Button>
          )}
          {canReview && tc.status === "REJECTED" && (
            <Button className="flex-[1_1_120px]" variant="secondary" onClick={onReopen}>
              Reopen as draft
            </Button>
          )}
          {canWrite && (
            <Button className="flex-[1_1_80px]" variant="secondary" onClick={onEdit}>
              Edit
            </Button>
          )}
          {canReview && tc.status !== "REJECTED" && (
            <Button className="flex-[1_1_80px]" variant="warn" onClick={onReject}>
              Reject
            </Button>
          )}
          {canReview && tc.status !== "DRAFT" && tc.status !== "REJECTED" && (
            <Button className="flex-[1_1_120px]" variant="ghost" onClick={onReopen}>
              Back to draft
            </Button>
          )}
        </div>
      )}
      {canRunAi && canWrite && (
        <Button variant="dashed" onClick={() => setRewriting(true)}>
          Ask the assistant to rewrite this case
        </Button>
      )}
      {canWrite && (
        <Button variant="ghost" size="sm" className="text-warn self-start" onClick={onDelete}>
          Delete test case
        </Button>
      )}

      <Comments projectId={projectId} testCaseId={tc.id} canComment={canComment} />

      {rewriting && (
        <RewriteDialog
          projectId={projectId}
          tc={tc}
          onClose={() => setRewriting(false)}
          onApplied={async () => {
            setRewriting(false);
            await onChanged(`${tc.key} was rewritten and is back in Draft for approval.`);
          }}
        />
      )}
    </aside>
  );
}

interface Proposal {
  title: string;
  preconditions: string;
  steps: { action: string; expected: string | null }[];
  expectedResult: string;
  type: TestCaseTypeName;
  automatable: boolean;
}

/** "Ask the assistant to rewrite this case": instruction → proposal → accept or discard. */
function RewriteDialog({
  projectId,
  tc,
  onClose,
  onApplied,
}: {
  projectId: string;
  tc: TestCaseItem;
  onClose: () => void;
  onApplied: () => Promise<void>;
}) {
  const [job, setJob] = useState<JobItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const url = `/api/projects/${projectId}/test-cases/${tc.id}/rewrite`;
  const jobId = useRef<string | null>(null);

  const poll = useCallback(async () => {
    if (!jobId.current) return;
    const { job: fresh } = await api<{ job: JobItem }>(
      `/api/projects/${projectId}/jobs/${jobId.current}`,
    );
    setJob(fresh);
  }, [projectId]);
  usePolling(poll, isJobActive(job), 1500);

  async function ask(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const instruction = String(new FormData(e.currentTarget).get("instruction") ?? "");
    setError(null);
    setBusy(true);
    try {
      const res = await api<{ job: JobItem }>(url, { json: { instruction } });
      jobId.current = res.job.id;
      setJob(res.job);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't ask the assistant.");
    } finally {
      setBusy(false);
    }
  }

  async function accept() {
    if (!job) return;
    setBusy(true);
    setError(null);
    try {
      await api(url, { method: "PUT", json: { jobId: job.id } });
      await onApplied();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't apply the rewrite.");
      setBusy(false);
    }
  }

  const proposal =
    job?.status === "SUCCEEDED"
      ? ((job.result as { proposal?: Proposal } | null)?.proposal ?? null)
      : null;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        wide
        title={`Rewrite ${tc.key}`}
        description="Tell the assistant what to change. You'll see the result before anything is saved."
      >
        <div className="flex flex-col gap-4">
          {error && <Alert tone="error">{error}</Alert>}
          {!job && (
            <form onSubmit={ask} className="flex flex-col gap-3">
              <Field label="What should change?" htmlFor="rewrite-instruction">
                <Textarea
                  id="rewrite-instruction"
                  name="instruction"
                  required
                  minLength={3}
                  maxLength={1000}
                  placeholder="e.g. Use a half-day leave and check the remaining credits afterwards"
                />
              </Field>
              <Button type="submit" disabled={busy} className="self-start">
                Ask the assistant
              </Button>
            </form>
          )}
          {job && isJobActive(job) && (
            <p role="status" className="text-muted text-sm">
              The assistant is rewriting the case…
            </p>
          )}
          {job?.status === "FAILED" && (
            <Alert tone="error">{job.error ?? "The rewrite didn't work. Please try again."}</Alert>
          )}
          {proposal && (
            <>
              <div className="border-line flex flex-col gap-3 rounded-xl border p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-bold">{proposal.title}</h3>
                  <TypeBadge tc={proposal} />
                </div>
                <div className="flex flex-col gap-1">
                  <SectionLabel>Preconditions</SectionLabel>
                  <p className="text-sm">{proposal.preconditions}</p>
                </div>
                <div className="flex flex-col gap-1">
                  <SectionLabel>Steps</SectionLabel>
                  <ol className="m-0 list-decimal pl-5 text-sm leading-relaxed">
                    {proposal.steps.map((s, i) => (
                      <li key={i}>
                        {s.action}
                        {s.expected && <span className="text-muted"> → {s.expected}</span>}
                      </li>
                    ))}
                  </ol>
                </div>
                <div className="flex flex-col gap-1">
                  <SectionLabel>Expected result</SectionLabel>
                  <p className="text-sm">{proposal.expectedResult}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void accept()} disabled={busy}>
                  Use this version
                </Button>
                <Button variant="secondary" onClick={() => setJob(null)} disabled={busy}>
                  Try another instruction
                </Button>
                <Button variant="ghost" onClick={onClose}>
                  Discard
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Comments({
  projectId,
  testCaseId,
  canComment,
}: {
  projectId: string;
  testCaseId: string;
  canComment: boolean;
}) {
  const [comments, setComments] = useState<CommentItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const url = `/api/projects/${projectId}/comments`;

  useEffect(() => {
    let cancelled = false;
    api<{ comments: CommentItem[] }>(`${url}?targetType=TEST_CASE&targetId=${testCaseId}`)
      .then((r) => !cancelled && setComments(r.comments))
      .catch(() => !cancelled && setComments([]));
    return () => {
      cancelled = true;
    };
  }, [url, testCaseId]);

  async function post(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const body = String(new FormData(form).get("body") ?? "").trim();
    if (!body) return;
    setBusy(true);
    setError(null);
    try {
      const { comment } = await api<{ comment: CommentItem }>(url, {
        json: { targetType: "TEST_CASE", targetId: testCaseId, body },
      });
      setComments((cs) => [...(cs ?? []), comment]);
      form.reset();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't post the comment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Comments" className="border-line-soft flex flex-col gap-3 border-t pt-4">
      <SectionLabel>Comments{comments ? ` (${comments.length})` : ""}</SectionLabel>
      {comments?.map((c) => (
        <div key={c.id} className="flex flex-col gap-0.5 text-sm">
          <span className="text-[13px] font-semibold">
            {c.author.name}{" "}
            <span className="text-muted font-normal" suppressHydrationWarning>
              · {activityLabel("", c.createdAt).trim()}
            </span>
          </span>
          <p className="leading-normal whitespace-pre-wrap">{c.body}</p>
        </div>
      ))}
      {comments?.length === 0 && <p className="text-muted text-[13px]">No comments yet.</p>}
      {error && <Alert tone="error">{error}</Alert>}
      {canComment && (
        <form onSubmit={post} className="flex flex-col gap-2">
          <label htmlFor={`comment-${testCaseId}`} className="sr-only">
            Add a comment
          </label>
          <Textarea
            id={`comment-${testCaseId}`}
            name="body"
            required
            maxLength={4000}
            className="min-h-16"
            placeholder="Add a comment for the team"
          />
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            className="self-start"
            disabled={busy}
          >
            Comment
          </Button>
        </form>
      )}
    </section>
  );
}

function RejectDialog({
  count,
  onClose,
  onConfirm,
}: {
  count: number;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={`Reject ${plural(count, "test case")}`}
        description="Say why, so the team (and the assistant, if you ask it to rewrite) knows what to fix."
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            onConfirm(reason.trim());
          }}
        >
          <Field label="Reason" htmlFor="reject-reason">
            <Textarea
              id="reject-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              maxLength={1000}
            />
          </Field>
          <Button type="submit" variant="danger" disabled={!reason.trim()}>
            Reject
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DownloadDialog({
  projectId,
  requirementCount,
  canExport,
  filterQuery,
  onClose,
}: {
  projectId: string;
  requirementCount: number;
  canExport: boolean;
  filterQuery: string;
  onClose: () => void;
}) {
  const href = (format: "csv" | "xlsx") =>
    `/api/projects/${projectId}/test-cases/export?format=${format}${filterQuery ? `&${filterQuery}` : ""}`;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="Download"
        description="Share the scope, or take the test cases to another tool."
      >
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3 p-4">
            <h3 className="font-bold">Test cases</h3>
            <p className="text-muted text-[13px]">
              Every field of the cases shown with your current filters.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" asChild>
                <a href={href("xlsx")}>Excel</a>
              </Button>
              <Button variant="secondary" asChild>
                <a href={href("csv")}>CSV</a>
              </Button>
            </div>
          </Card>
          <TestScopeCard
            projectId={projectId}
            requirements={requirementCount}
            canExport={canExport}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
