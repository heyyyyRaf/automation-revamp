"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { DownloadIcon } from "@/components/icons";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/form";
import { api, ApiError } from "@/lib/api-client";
import { startDownload } from "@/lib/download";
import { plural } from "@/lib/format";
import {
  isJobActive,
  jobNote,
  type AiBudgetItem,
  type ExportItem,
  type JobItem,
  type QuestionItem,
} from "@/lib/types";
import { usePolling } from "@/lib/use-polling";
import { cn } from "@/lib/utils";
import { ProgressBar } from "@/components/ui/progress-bar";

interface FailedChunk {
  name: string;
  part: number;
  parts: number;
  error: string;
}

function etaLabel(seconds: number | undefined): string | null {
  if (seconds === undefined || seconds <= 0) return null;
  if (seconds < 60) return "less than a minute left";
  const min = Math.round(seconds / 60);
  return `about ${min} min left`;
}

/** "2. What the assistant found" (design: Upload). */
export function AssistantPanel({
  projectId,
  initialJob,
  budget,
  counts,
  openQuestions,
  canRun,
  canWrite,
  canExport,
  hasInput,
  filesReading,
}: {
  projectId: string;
  initialJob: JobItem | null;
  budget: AiBudgetItem;
  counts: { requirements: number; flows: number; questions: number };
  openQuestions: QuestionItem[];
  canRun: boolean;
  canWrite: boolean;
  canExport: boolean;
  hasInput: boolean;
  filesReading: number;
}) {
  return (
    <section aria-labelledby="found-heading" className="flex flex-[1_1_340px] flex-col gap-4">
      <h2 id="found-heading" className="text-[19px] font-bold">
        2. What the assistant found
      </h2>
      <AnalysisCard
        projectId={projectId}
        initialJob={initialJob}
        budget={budget}
        counts={counts}
        canRun={canRun}
        hasInput={hasInput}
        filesReading={filesReading}
      />
      {openQuestions.length > 0 && (
        <QuestionsCard projectId={projectId} questions={openQuestions} canWrite={canWrite} />
      )}
      <TestScopeCard
        projectId={projectId}
        requirements={counts.requirements}
        canExport={canExport}
      />
    </section>
  );
}

function AnalysisCard({
  projectId,
  initialJob,
  budget,
  counts,
  canRun,
  hasInput,
  filesReading,
}: {
  projectId: string;
  initialJob: JobItem | null;
  budget: AiBudgetItem;
  counts: { requirements: number; flows: number; questions: number };
  canRun: boolean;
  hasInput: boolean;
  filesReading: number;
}) {
  const router = useRouter();
  const [job, setJob] = useState(initialJob);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const base = `/api/projects/${projectId}`;
  const wasActive = useRef(isJobActive(initialJob));

  const refresh = useCallback(async () => {
    const { jobs } = await api<{ jobs: JobItem[] }>(`${base}/jobs?types=ANALYZE_REQUIREMENTS`);
    setJob(jobs[0] ?? null);
  }, [base]);
  usePolling(refresh, isJobActive(job), 2000);

  // When the analysis finishes, reload the server parts (counts, questions, progress bar).
  useEffect(() => {
    const active = isJobActive(job);
    if (wasActive.current && !active) router.refresh();
    wasActive.current = active;
  }, [job, router]);

  async function start(retryJobId?: string) {
    setPending(true);
    setError(null);
    try {
      const res = await api<{ job: JobItem }>(`${base}/analysis`, {
        method: "POST",
        ...(retryJobId ? { json: { retryJobId } } : {}),
      });
      setJob(res.job);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't start the analysis.");
    } finally {
      setPending(false);
    }
  }

  const running = isJobActive(job);
  const { note, etaSeconds } = jobNote(job);
  const result =
    job?.status === "SUCCEEDED" ? (job.result as Record<string, unknown> | null) : null;
  const failed = (result?.failedChunks as FailedChunk[] | undefined) ?? [];
  const lowBudget = budget.remaining <= 0;

  return (
    <Card className="flex flex-col gap-3.5 p-5">
      {error && <Alert tone="error">{error}</Alert>}
      {running ? (
        <div role="status" aria-live="polite" className="flex flex-col gap-3.5">
          <div className="flex flex-wrap justify-between gap-2 text-sm">
            <span className="font-semibold">
              {job?.status === "QUEUED" ? "Waiting to start…" : (note ?? "Reading your files…")}
            </span>
            <span className="text-muted">{etaLabel(etaSeconds)}</span>
          </div>
          <ProgressBar
            value={job?.progress ?? 0}
            min={5}
            height="h-2.5"
            label="Analysis progress"
          />
        </div>
      ) : job?.status === "FAILED" ? (
        <Alert tone="error" title="The analysis didn't finish">
          {job.error ?? "Please try again."}
        </Alert>
      ) : job?.status === "SUCCEEDED" ? (
        <p className="text-muted text-sm">
          {failed.length > 0
            ? `Read everything except ${plural(failed.length, "part")} — what was found is saved.`
            : "Analysis finished. Running it again only adds new findings."}
        </p>
      ) : (
        <p className="text-muted text-sm">
          The assistant reads every file and lists the requirements, user flows and anything
          unclear.
        </p>
      )}

      <div className="grid grid-cols-3 gap-2.5">
        <CountTile
          href={`/projects/${projectId}/requirements`}
          value={counts.requirements}
          label="requirements"
        />
        <CountTile
          href={`/projects/${projectId}/requirements#flows`}
          value={counts.flows}
          label="user flows"
        />
        <CountTile
          href={`/projects/${projectId}/requirements#questions`}
          value={counts.questions}
          label="questions"
          warn
        />
      </div>

      {failed.length > 0 && !running && (
        <div className="bg-warn-faint text-warn-ink flex flex-col gap-2 rounded-xl p-3 text-[13px]">
          <p className="font-semibold">Couldn&apos;t read:</p>
          <ul className="list-disc pl-5">
            {failed.map((f) => (
              <li key={`${f.name}-${f.part}`}>
                {f.name}
                {f.parts > 1 ? ` (part ${f.part} of ${f.parts})` : ""} — {f.error}
              </li>
            ))}
          </ul>
          {canRun && (
            <Button
              size="sm"
              variant="secondary"
              className="self-start"
              disabled={pending}
              onClick={() => void start(job?.id)}
            >
              Retry failed parts
            </Button>
          )}
        </div>
      )}

      {canRun && (
        <Button
          onClick={() => void start()}
          disabled={!hasInput || running || pending || filesReading > 0 || lowBudget}
        >
          {job ? "Analyse again" : "Analyse my files"}
        </Button>
      )}
      <p className="text-muted text-xs">
        {!hasInput
          ? "Add at least one file to start."
          : filesReading > 0
            ? `${plural(filesReading, "file")} still being read…`
            : lowBudget
              ? "This project has used its monthly AI limit. Ask an Admin to raise it."
              : `AI use this month: ${budget.used.toLocaleString()} of ${budget.cap.toLocaleString()} tokens.`}
      </p>
    </Card>
  );
}

function CountTile({
  href,
  value,
  label,
  warn,
}: {
  href: string;
  value: number;
  label: string;
  warn?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "hover:ring-control flex flex-col gap-0.5 rounded-[10px] p-3 no-underline hover:ring-1",
        warn && value > 0 ? "bg-warn-faint" : "bg-page",
      )}
    >
      <span className={cn("text-[22px] font-bold", warn && value > 0 ? "text-warn" : "text-ink")}>
        {value}
      </span>
      <span className={cn("text-xs", warn && value > 0 ? "text-warn-ink" : "text-muted")}>
        {label}
      </span>
    </Link>
  );
}

function questionSource(q: QuestionItem): string | null {
  const doc = q.requirement?.sourceDocument?.originalName;
  if (!doc) return q.requirement ? q.requirement.key : null;
  return q.requirement?.sourceSection ? `${doc}, ${q.requirement.sourceSection}` : doc;
}

function QuestionsCard({
  projectId,
  questions,
  canWrite,
}: {
  projectId: string;
  questions: QuestionItem[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [answering, setAnswering] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(id: string, body: { answer: string } | { status: "DISMISSED" }) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/projects/${projectId}/questions/${id}`, { method: "PATCH", json: body });
      setAnswering(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3.5 p-5">
      <div className="flex flex-col gap-1">
        <h3 className="font-bold">A few things to confirm</h3>
        <p className="text-muted text-[13px] leading-normal">
          The documents were unclear here. Your answer shapes the test cases.
        </p>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {questions.map((q) => {
        const source = questionSource(q);
        const fieldId = `answer-${q.id}`;
        return (
          <div
            key={q.id}
            className="border-line-soft flex flex-col gap-2.5 rounded-xl border p-3.5"
          >
            <p className="text-sm leading-normal">{q.question}</p>
            {source && <p className="text-muted text-xs">From {source}</p>}
            {answering === q.id ? (
              <form
                className="flex flex-col gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const answer = String(new FormData(e.currentTarget).get("answer") ?? "").trim();
                  if (answer) void save(q.id, { answer });
                }}
              >
                <label htmlFor={fieldId} className="sr-only">
                  Your answer
                </label>
                <Textarea id={fieldId} name="answer" required maxLength={2000} autoFocus />
                <div className="flex gap-2">
                  <Button type="submit" size="sm" disabled={busy}>
                    Save answer
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setAnswering(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              canWrite && (
                <div className="flex gap-2">
                  <Button size="sm" variant="soft" onClick={() => setAnswering(q.id)}>
                    Answer
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void save(q.id, { status: "DISMISSED" })}
                  >
                    Skip for now
                  </Button>
                </div>
              )
            )}
          </div>
        );
      })}
    </Card>
  );
}

const SCOPE_FORMATS = [
  { format: "PDF", label: "PDF" },
  { format: "XLSX", label: "Excel" },
  { format: "DOCX", label: "Word" },
] as const;

/** "Download test scope": builds the file in the background, then offers it. */
export function TestScopeCard({
  projectId,
  requirements,
  canExport,
}: {
  projectId: string;
  requirements: number;
  canExport: boolean;
}) {
  const [current, setCurrent] = useState<ExportItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/projects/${projectId}/exports`;
  const preparing = current?.status === "QUEUED" || current?.status === "RUNNING";

  const reload = useCallback(async () => {
    if (!current) return;
    const { exports } = await api<{ exports: ExportItem[] }>(base);
    const fresh = exports.find((e) => e.id === current.id);
    if (fresh) {
      setCurrent(fresh);
      if (fresh.status === "SUCCEEDED") startDownload(`${base}/${fresh.id}/file`);
    }
  }, [base, current]);
  usePolling(reload, preparing, 1500);

  async function create(format: "PDF" | "XLSX" | "DOCX") {
    setError(null);
    try {
      const { export: exp } = await api<{ export: ExportItem }>(base, { json: { format } });
      setCurrent(exp);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't start the download.");
    }
  }

  return (
    <Card className="border-accent flex flex-col gap-3.5 border-2 p-5">
      <div className="flex items-center gap-3">
        <div className="bg-accent-soft text-link flex size-10 shrink-0 items-center justify-center rounded-xl">
          <DownloadIcon size={20} />
        </div>
        <div className="flex flex-col gap-0.5">
          <h3 className="font-bold">Download test scope</h3>
          <p className="text-muted text-[13px]">QA requirements for this project, ready to share</p>
        </div>
      </div>
      <ul className="text-ink-2 m-0 list-disc pl-[18px] text-[13px] leading-[1.7]">
        <li>Features in scope and out of scope</li>
        <li>{plural(requirements, "requirement")} with IDs (traceability matrix)</li>
        <li>Test approach, environments, test accounts needed</li>
        <li>Entry and exit criteria, open questions</li>
      </ul>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        {SCOPE_FORMATS.map(({ format, label }, i) => (
          <Button
            key={format}
            variant={i === 0 ? "primary" : "secondary"}
            className="flex-[1_1_90px]"
            disabled={!canExport || preparing}
            onClick={() => void create(format)}
          >
            {label}
          </Button>
        ))}
      </div>
      <p className="text-muted text-xs" role="status" aria-live="polite">
        {preparing
          ? "Preparing your file…"
          : current?.status === "FAILED"
            ? (current.error ?? "The file couldn't be made. Please try again.")
            : current?.status === "SUCCEEDED"
              ? "Your download has started."
              : "Updates as you answer questions or edit requirements."}
      </p>
    </Card>
  );
}
