"use client";

import { Check, ClipboardList, Plus, RotateCcw, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/states";
import { api, ApiError } from "@/lib/api-client";
import type { TestCaseItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { TestCaseDialog, type RequirementOption } from "./test-case-dialog";

type StatusFilter = "ALL" | TestCaseItem["status"];

export const STATUS_BADGE: Record<
  TestCaseItem["status"],
  { label: string; tone: "neutral" | "success" | "danger" }
> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  APPROVED: { label: "Approved", tone: "success" },
  REJECTED: { label: "Rejected", tone: "danger" },
};

const TYPE_LABEL: Record<TestCaseItem["type"], string> = {
  POSITIVE: "Positive",
  NEGATIVE: "Negative",
  BOUNDARY: "Boundary",
};

export function TestCasesWorkspace({
  projectId,
  initialTestCases,
  requirements,
  canWrite,
  canReview,
}: {
  projectId: string;
  initialTestCases: TestCaseItem[];
  requirements: RequirementOption[];
  canWrite: boolean;
  canReview: boolean;
}) {
  const [testCases, setTestCases] = useState(initialTestCases);
  const [filter, setFilter] = useState<StatusFilter>("ALL");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<TestCaseItem | "new" | null>(null);
  const [rejecting, setRejecting] = useState<string[] | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const base = `/api/projects/${projectId}/test-cases`;

  const counts = useMemo(() => {
    const c = { ALL: testCases.length, DRAFT: 0, APPROVED: 0, REJECTED: 0 };
    for (const t of testCases) c[t.status]++;
    return c;
  }, [testCases]);
  const visible = filter === "ALL" ? testCases : testCases.filter((t) => t.status === filter);

  async function reload() {
    const res = await api<{ testCases: TestCaseItem[] }>(base);
    setTestCases(res.testCases);
  }

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
            : "moved back to draft";
      setMessage({
        tone: "success",
        text: `${res.updated} test case${res.updated === 1 ? "" : "s"} ${verb}.`,
      });
      setSelected(new Set());
      await reload();
    } catch (err) {
      setMessage({
        tone: "error",
        text: err instanceof ApiError ? err.message : "Couldn't save the review.",
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

  const selectedIds = [...selected];
  const filters: StatusFilter[] = ["ALL", "DRAFT", "APPROVED", "REJECTED"];

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle>Step 4 · Review test cases</CardTitle>
          <CardDescription>
            Read each case, edit it if needed, then approve or reject it. Only approved cases move
            on to automation. Editing an approved case sends it back to draft.
          </CardDescription>
        </div>
        {canWrite && (
          <Button
            variant="secondary"
            onClick={() => setOpen("new")}
            disabled={requirements.length === 0}
          >
            <Plus aria-hidden /> Add test case
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {message && <Alert tone={message.tone}>{message.text}</Alert>}

        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
          {filters.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={cn(
                "min-h-11 rounded-full border px-4 text-sm font-medium",
                filter === f
                  ? "border-accent bg-accent-soft text-accent-strong"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
              )}
            >
              {f === "ALL" ? "All" : STATUS_BADGE[f].label} ({counts[f]})
            </button>
          ))}
        </div>

        {canReview && selected.size > 0 && (
          <div className="bg-accent-soft flex flex-wrap items-center gap-2 rounded-lg p-3">
            <span className="text-accent-strong text-sm font-medium">{selected.size} selected</span>
            <Button size="sm" onClick={() => void review(selectedIds, "APPROVE")}>
              <Check aria-hidden /> Approve
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setRejecting(selectedIds)}>
              <X aria-hidden /> Reject
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void review(selectedIds, "REOPEN")}>
              <RotateCcw aria-hidden /> Back to draft
            </Button>
          </div>
        )}

        {testCases.length === 0 ? (
          <EmptyState
            icon={<ClipboardList />}
            title="No test cases yet"
            description="Generate them from your requirements with AI, or add them by hand."
            action={
              <Button asChild>
                <Link href={`/projects/${projectId}/requirements`}>Go to Requirements</Link>
              </Button>
            }
          />
        ) : visible.length === 0 ? (
          <p className="rounded-lg bg-slate-50 p-6 text-center text-slate-600">
            No test cases with this status.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {visible.map((t) => (
              <li key={t.id} className="flex items-start gap-3 py-3">
                {canReview && (
                  <input
                    type="checkbox"
                    className="accent-accent mt-1 size-5"
                    checked={selected.has(t.id)}
                    onChange={() => toggle(t.id)}
                    aria-label={`Select ${t.key}`}
                  />
                )}
                <button
                  type="button"
                  onClick={() => setOpen(t)}
                  className="focus-visible:ring-accent min-w-0 flex-1 rounded text-left focus-visible:ring-2 focus-visible:outline-none"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-slate-700">{t.key}</span>
                    <Badge tone={STATUS_BADGE[t.status].tone}>{STATUS_BADGE[t.status].label}</Badge>
                    <Badge>{TYPE_LABEL[t.type]}</Badge>
                    <Badge tone={t.priority === "HIGH" ? "warning" : "neutral"}>
                      {t.priority.toLowerCase()} priority
                    </Badge>
                    {t.automatable && <Badge tone="info">Automatable</Badge>}
                  </div>
                  <p className="mt-1 font-medium text-slate-900">{t.title}</p>
                  <p className="text-sm text-slate-500">
                    Covers {t.requirements.map((r) => r.key).join(", ") || "—"} · {t.steps.length}{" "}
                    step{t.steps.length === 1 ? "" : "s"}
                    {t.status === "REJECTED" && t.rejectionReason
                      ? ` · Rejected: ${t.rejectionReason}`
                      : ""}
                  </p>
                </button>
                {canReview && t.status === "DRAFT" && (
                  <div className="flex shrink-0 gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void review([t.id], "APPROVE")}
                      aria-label={`Approve ${t.key}`}
                    >
                      <Check aria-hidden />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setRejecting([t.id])}
                      aria-label={`Reject ${t.key}`}
                    >
                      <X aria-hidden />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {open && (
        <TestCaseDialog
          projectId={projectId}
          testCase={open === "new" ? null : open}
          requirements={requirements}
          canWrite={canWrite}
          canReview={canReview}
          onClose={() => setOpen(null)}
          onSaved={(text) => {
            setOpen(null);
            setMessage({ tone: "success", text });
            void reload();
          }}
          onReview={(decision) => {
            if (open === "new") return;
            setOpen(null);
            if (decision === "REJECT") setRejecting([open.id]);
            else void review([open.id], decision);
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
    </Card>
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
        title={`Reject ${count} test case${count === 1 ? "" : "s"}`}
        description="Say why, so the team knows what to fix."
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
