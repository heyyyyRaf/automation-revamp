"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DownloadIcon, PlayIcon } from "@/components/icons";
import { PageHeader } from "@/components/project/page-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionLabel } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/states";
import { api, ApiError } from "@/lib/api-client";
import { activityLabel, plural } from "@/lib/format";
import {
  isJobActive,
  jobNote,
  type JobItem,
  type ScriptDetailItem,
  type ScriptListItem,
  type ScriptState,
} from "@/lib/types";
import { usePolling } from "@/lib/use-polling";
import { cn } from "@/lib/utils";
import { RunDialog, type RunTargets } from "../runs/run-dialog";
import { CodeView } from "./code-view";

const STATE: Record<ScriptState, { label: string; dot: string }> = {
  APPROVED: { label: "Approved", dot: "text-success" },
  READY: { label: "Ready", dot: "text-success" },
  EDITED: { label: "Edited", dot: "text-link" },
  NEEDS_EDIT: { label: "Needs look", dot: "text-warn" },
  NOT_GENERATED: { label: "Not written", dot: "text-muted" },
};

const SOURCE = { AI_GENERATED: "Written by AI", MANUAL_EDIT: "Edited by", AI_FIX: "Fixed by AI" };

/** "TC-003 Block a request…" → "tc-003-block-a-request.spec.ts" (display only). */
function fileName(key: string, title: string) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${key.toLowerCase()}-${slug}.spec.ts`;
}

/** Design: "Review test scripts" — list, code, and the checks for the selected script. */
export function ScriptsWorkspace({
  projectId,
  projectName,
  archived,
  initialScripts,
  runTargets,
  canWrite,
  canApprove,
  canRun,
  initialJob,
}: {
  projectId: string;
  projectName: string;
  archived: boolean;
  initialScripts: ScriptListItem[];
  runTargets: RunTargets;
  canWrite: boolean;
  canApprove: boolean;
  canRun: boolean;
  initialJob: JobItem | null;
}) {
  const router = useRouter();
  const [scripts, setScripts] = useState(initialScripts);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(
    initialScripts.find((s) => s.scriptId)?.testCaseId ?? initialScripts[0]?.testCaseId ?? null,
  );
  const [detail, setDetail] = useState<ScriptDetailItem | null>(null);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [job, setJob] = useState<JobItem | null>(initialJob);
  const [writing, setWriting] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [running, setRunning] = useState<string[] | null>(null);
  const base = `/api/projects/${projectId}/scripts`;
  const wasActive = useRef(isJobActive(initialJob));

  const reloadList = useCallback(async () => {
    const res = await api<{ scripts: ScriptListItem[] }>(base);
    setScripts(res.scripts);
  }, [base]);

  const current = scripts.find((s) => s.testCaseId === selected) ?? null;

  const loadDetail = useCallback(
    async (scriptId: string) => {
      const res = await api<{ script: ScriptDetailItem }>(`${base}/${scriptId}`);
      setDetail(res.script);
      setVersionId(res.script.versions[0]?.id ?? null);
    },
    [base],
  );

  // Fetch the selected script whenever the selection (or its latest version) changes.
  useEffect(() => {
    const scriptId = current?.scriptId;
    if (!scriptId) return;
    let cancelled = false;
    api<{ script: ScriptDetailItem }>(`${base}/${scriptId}`)
      .then((res) => {
        if (cancelled) return;
        setDetail(res.script);
        setVersionId(res.script.versions[0]?.id ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [base, current?.scriptId, current?.version]);

  const pollJob = useCallback(async () => {
    if (!job) return;
    const { job: fresh } = await api<{ job: JobItem }>(`/api/projects/${projectId}/jobs/${job.id}`);
    setJob(fresh);
  }, [job, projectId]);
  usePolling(pollJob, isJobActive(job), 2000);

  useEffect(() => {
    const active = isJobActive(job);
    if (wasActive.current && !active) {
      void reloadList();
      router.refresh();
    }
    wasActive.current = active;
  }, [job, reloadList, router]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? scripts.filter((s) => `${s.key} ${s.title}`.toLowerCase().includes(q)) : scripts;
  }, [scripts, query]);

  const written = scripts.filter((s) => s.state !== "NOT_GENERATED");
  const needLook = scripts.filter((s) => s.state === "NEEDS_EDIT").length;
  const approvedCount = scripts.filter((s) => s.state === "APPROVED").length;
  // The loaded detail belongs to the selected script only once it has arrived.
  const shownDetail =
    detail && current && detail.testCase.id === current.testCaseId ? detail : null;
  const version =
    shownDetail?.versions.find((v) => v.id === versionId) ?? shownDetail?.versions[0] ?? null;
  const isLatest = version?.id === shownDetail?.versions[0]?.id;
  const flagged = new Set(
    version?.checks.selectorCheck.filter((c) => c.status === "missing").map((c) => c.line) ?? [],
  );

  function fail(err: unknown, fallback: string) {
    setMessage({ tone: "error", text: err instanceof ApiError ? err.message : fallback });
  }

  async function saveEdit() {
    if (!shownDetail) return;
    try {
      await api(`${base}/${shownDetail.id}/versions`, { json: { code: draft } });
      setEditing(false);
      setMessage({
        tone: "success",
        text: "Saved as a new version. Approve it when you're happy.",
      });
      await reloadList();
      await loadDetail(shownDetail.id);
    } catch (err) {
      fail(err, "Couldn't save the script.");
    }
  }

  async function decide(decision: "APPROVE" | "REVOKE") {
    if (!shownDetail || !version) return;
    try {
      await api(`${base}/${shownDetail.id}/approval`, {
        json: { versionId: version.id, decision },
      });
      setMessage({
        tone: "success",
        text:
          decision === "APPROVE"
            ? `${shownDetail.testCase.key} is approved and can run.`
            : "Approval withdrawn.",
      });
      await reloadList();
      await loadDetail(shownDetail.id);
      router.refresh();
    } catch (err) {
      fail(err, "Couldn't save the decision.");
    }
  }

  const running_ = isJobActive(job);
  const { note } = jobNote(job);

  return (
    <>
      <PageHeader
        crumbs={[
          { label: "Projects", href: "/projects" },
          { label: projectName, href: `/projects/${projectId}` },
          { label: "Test scripts" },
        ]}
        title="Review test scripts"
        archived={archived}
        subtitle={`${plural(written.length, "Playwright script")} written from approved cases · ${approvedCount} approved · ${needLook} need a quick look`}
        actions={
          <>
            {canWrite && (
              <Button variant="secondary" onClick={() => setWriting(true)} disabled={running_}>
                Write scripts
              </Button>
            )}
            <Button variant="secondary" asChild>
              <a href={`${base}/download`} aria-disabled={approvedCount === 0}>
                <DownloadIcon /> Download scripts (.zip)
              </a>
            </Button>
            {canRun && (
              <Button onClick={() => setRunning([])} disabled={approvedCount === 0}>
                <PlayIcon /> Run and watch
              </Button>
            )}
          </>
        }
      />
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      {job?.status === "FAILED" && (
        <Alert tone="error">{job.error ?? "That didn't work. Please try again."}</Alert>
      )}
      {running_ && (
        <Alert tone="info" title={note ?? "Working…"}>
          The assistant opens the app, reads the real pages and writes each script. This can take a
          few minutes.
        </Alert>
      )}
      {job?.status === "SUCCEEDED" && !running_ && job.type === "GENERATE_SCRIPT" && (
        <GenerationResult result={job.result} />
      )}

      {scripts.length === 0 ? (
        <EmptyState
          title="No approved, automatable test case yet"
          description="Scripts are written only for approved test cases that a browser can check. Approve some on the Review page first."
          action={
            <Button asChild>
              <Link href={`/projects/${projectId}/test-cases`}>Review test cases</Link>
            </Button>
          }
        />
      ) : (
        <div className="flex flex-wrap items-start gap-5">
          <section
            aria-label="Script files"
            className="border-line rounded-card flex min-w-0 flex-[1_1_250px] flex-col gap-1 border bg-white p-3"
          >
            <label htmlFor="script-search" className="sr-only">
              Search scripts
            </label>
            <input
              id="script-search"
              type="search"
              placeholder="Search scripts"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="border-control mb-2 h-10 rounded-lg border px-3 text-sm"
            />
            {shown.map((s) => (
              <button
                key={s.testCaseId}
                type="button"
                onClick={() => {
                  setSelected(s.testCaseId);
                  setEditing(false);
                }}
                aria-pressed={s.testCaseId === selected}
                className={cn(
                  "text-ink flex min-h-11 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left",
                  s.testCaseId === selected ? "bg-accent-soft" : "hover:bg-page",
                )}
              >
                <span
                  className={cn("size-2 shrink-0 rounded-full bg-current", STATE[s.state].dot)}
                  aria-hidden
                />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="font-mono text-[12.5px] font-medium">{s.key}</span>
                  <span className="text-ink-2 truncate text-[13px]">{s.title}</span>
                </span>
                <span className={cn("text-[11px] font-semibold", STATE[s.state].dot)}>
                  {STATE[s.state].label}
                </span>
              </button>
            ))}
          </section>

          <section
            aria-label="Script editor"
            className="rounded-card flex min-w-0 flex-[999_1_520px] flex-col overflow-hidden border border-[#1F2433] bg-[#161A26]"
          >
            <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-[#2A3043] bg-[#1E2332] px-3.5 py-2.5">
              <div className="flex items-center gap-2.5">
                <span className="font-mono text-[13px] text-[#E6E9F2]">
                  tests/{current ? fileName(current.key, current.title) : ""}
                </span>
                {editing && <span className="text-xs font-semibold text-[#F5B37A]">● Editing</span>}
              </div>
              {shownDetail && (
                <div className="flex flex-wrap gap-2">
                  {canWrite && isLatest && (
                    <DarkButton
                      onClick={() => {
                        if (editing) void saveEdit();
                        else {
                          setDraft(version?.code ?? "");
                          setEditing(true);
                        }
                      }}
                    >
                      {editing ? "Save changes" : "Edit script"}
                    </DarkButton>
                  )}
                  {editing && <DarkButton onClick={() => setEditing(false)}>Cancel</DarkButton>}
                  {canWrite && !editing && (
                    <DarkButton onClick={() => setFixing(true)}>Ask AI to fix</DarkButton>
                  )}
                  {canRun && !editing && (
                    <DarkButton
                      onClick={() => setRunning([shownDetail.testCase.id])}
                      disabled={shownDetail.approvedVersionId === null}
                      title={shownDetail.approvedVersionId ? undefined : "Approve the script first"}
                    >
                      Run this test
                    </DarkButton>
                  )}
                </div>
              )}
            </div>
            {!shownDetail || !version ? (
              <div className="flex min-h-[420px] flex-col items-center justify-center gap-3 p-6 text-center text-[#AEB5C8]">
                <p>{current ? "No script written for this case yet." : "Choose a script."}</p>
                {canWrite && current && (
                  <Button size="sm" variant="secondary" onClick={() => setWriting(true)}>
                    Write it
                  </Button>
                )}
              </div>
            ) : editing ? (
              <>
                <label htmlFor="code-edit" className="sr-only">
                  Script code
                </label>
                <textarea
                  id="code-edit"
                  spellCheck={false}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  className="block min-h-[420px] w-full resize-y border-0 bg-[#161A26] px-[18px] py-4 font-mono text-[13px] leading-[1.75] text-[#E6E9F2] outline-none"
                />
              </>
            ) : (
              <CodeView code={version.code} flagged={flagged} />
            )}
            <div className="flex flex-wrap justify-between gap-2 border-t border-[#2A3043] bg-[#1E2332] px-3.5 py-2 text-xs text-[#AEB5C8]">
              <span>TypeScript · Playwright</span>
              <span suppressHydrationWarning>
                {editing
                  ? "Unsaved changes"
                  : version
                    ? `v${version.version} · ${SOURCE[version.source]}${version.source === "MANUAL_EDIT" ? ` ${version.createdBy ?? "a tester"}` : ""} · ${activityLabel("saved", version.createdAt)}`
                    : ""}
              </span>
            </div>
          </section>

          <aside
            aria-label="Script checks"
            className="flex min-w-0 flex-[1_1_280px] flex-col gap-4"
          >
            {current && (
              <Card className="flex flex-col gap-2.5 p-[18px]">
                <SectionLabel>From test case</SectionLabel>
                <div className="leading-snug font-bold">{current.title}</div>
                <div className="text-muted font-mono text-[12.5px]">
                  {current.key} · {current.requirementKeys.join(", ") || "—"}
                </div>
                <Link
                  href={`/projects/${projectId}/test-cases`}
                  className="text-[13px] font-semibold"
                >
                  Open the test case
                </Link>
              </Card>
            )}
            {shownDetail && version && (
              <Card className="flex flex-col gap-3 p-[18px]">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-bold">Approval</h2>
                  {shownDetail.approvedVersionId === version.id ? (
                    <Badge tone="success">Approved</Badge>
                  ) : (
                    <Badge tone="neutral">Not approved</Badge>
                  )}
                </div>
                <p className="text-muted text-[13px] leading-normal">
                  {shownDetail.approvedVersionId === version.id
                    ? `Approved by ${shownDetail.approvedBy ?? "a tester"}. This exact version is what runs.`
                    : "Nothing runs until you approve it. Read the script, then approve the latest version."}
                </p>
                {!version.checks.typeCheckOk || !version.checks.safetyCheckOk ? (
                  <Alert tone="error" title="This version has errors">
                    <ul className="list-disc pl-4">
                      {[...version.checks.typeCheckLog, ...version.checks.safetyIssues]
                        .slice(0, 6)
                        .map((d, i) => (
                          <li key={i}>
                            Line {d.line}: {d.message}
                          </li>
                        ))}
                    </ul>
                  </Alert>
                ) : null}
                {version.notes && (
                  <p className="text-ink-2 text-[13px] leading-normal">AI note: {version.notes}</p>
                )}
                {shownDetail.versions.length > 1 && (
                  <Field label="Version" htmlFor="version-select">
                    <Select
                      id="version-select"
                      value={version.id}
                      onChange={(e) => {
                        setVersionId(e.target.value);
                        setEditing(false);
                      }}
                    >
                      {shownDetail.versions.map((v) => (
                        <option key={v.id} value={v.id}>
                          v{v.version} · {SOURCE[v.source]}
                          {v.source === "MANUAL_EDIT" ? ` ${v.createdBy ?? "a tester"}` : ""}
                          {v.id === shownDetail.approvedVersionId ? " · approved" : ""}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                {canApprove && isLatest && shownDetail.approvedVersionId !== version.id && (
                  <Button
                    onClick={() => void decide("APPROVE")}
                    disabled={!version.checks.typeCheckOk || !version.checks.safetyCheckOk}
                  >
                    Approve this script
                  </Button>
                )}
                {canApprove && shownDetail.approvedVersionId && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="self-start"
                    onClick={() => void decide("REVOKE")}
                  >
                    Withdraw approval
                  </Button>
                )}
              </Card>
            )}
            {version && (
              <Card className="flex flex-col gap-3 p-[18px]">
                <div className="flex flex-col gap-1">
                  <h2 className="font-bold">Selector check</h2>
                  <p className="text-muted text-[13px] leading-normal">
                    Each element the script uses, matched on the captured page
                    {shownDetail?.environment ? ` of ${shownDetail.environment.name}` : ""}.
                  </p>
                </div>
                {version.checks.selectorCheck.length === 0 ? (
                  <p className="text-muted text-[13px]">No element to check.</p>
                ) : (
                  version.checks.selectorCheck.map((c, i) => (
                    <div key={i} className="flex items-start gap-2.5">
                      <span
                        className={cn(
                          "inline-flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                          c.status === "found"
                            ? "bg-success-soft text-success"
                            : c.status === "missing"
                              ? "bg-warn-soft text-warn"
                              : "bg-neutral-soft text-muted",
                        )}
                        aria-hidden
                      >
                        {c.status === "found" ? "✓" : c.status === "missing" ? "!" : "?"}
                      </span>
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-[13px] font-semibold">
                          Line {c.line} ·{" "}
                          {c.status === "found"
                            ? "found"
                            : c.status === "missing"
                              ? "not on the page"
                              : "not checked"}
                        </span>
                        <span className="text-muted font-mono text-[11.5px] [overflow-wrap:anywhere]">
                          {c.selector}
                        </span>
                      </span>
                    </div>
                  ))
                )}
              </Card>
            )}
          </aside>
        </div>
      )}

      {writing && (
        <WriteDialog
          projectId={projectId}
          environments={runTargets.environments}
          selected={current?.state === "NOT_GENERATED" || !current ? null : current}
          missing={scripts.filter((s) => s.state === "NOT_GENERATED").length}
          onClose={() => setWriting(false)}
          onStarted={(j) => {
            setWriting(false);
            setJob(j);
            wasActive.current = true;
          }}
        />
      )}
      {fixing && shownDetail && (
        <FixDialog
          url={`${base}/${shownDetail.id}/fix`}
          onClose={() => setFixing(false)}
          onStarted={(j) => {
            setFixing(false);
            setJob(j);
            wasActive.current = true;
          }}
        />
      )}
      {running && (
        <RunDialog
          projectId={projectId}
          targets={runTargets}
          {...(running.length ? { testCaseIds: running, title: "Run this test" } : {})}
          onClose={() => setRunning(null)}
        />
      )}
    </>
  );
}

function DarkButton({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "h-9 rounded-lg border border-[#3A4159] bg-[#262C3F] px-3.5 text-[13px] font-semibold text-[#E6E9F2] hover:bg-[#2F364C] disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

function GenerationResult({ result }: { result: unknown }) {
  const r = result as {
    generated?: number;
    needsEdit?: number;
    failed?: { key: string; error: string }[];
  } | null;
  if (!r || typeof r.generated !== "number") return null;
  return (
    <Alert tone={r.needsEdit || r.failed?.length ? "error" : "success"}>
      Wrote {plural(r.generated, "script")}.
      {r.needsEdit
        ? ` ${plural(r.needsEdit, "script")} still had errors after one retry — marked “Needs look”.`
        : ""}
      {r.failed?.length ? ` Not written: ${r.failed.map((f) => f.key).join(", ")}.` : ""}
    </Alert>
  );
}

function WriteDialog({
  projectId,
  environments,
  selected,
  missing,
  onClose,
  onStarted,
}: {
  projectId: string;
  environments: RunTargets["environments"];
  selected: ScriptListItem | null;
  missing: number;
  onClose: () => void;
  onStarted: (job: JobItem) => void;
}) {
  const [environmentId, setEnvironmentId] = useState(
    environments.find((e) => e.verified)?.id ?? environments[0]?.id ?? "",
  );
  const [which, setWhich] = useState<"missing" | "selected">(missing > 0 ? "missing" : "selected");
  const [startPath, setStartPath] = useState("/");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function start(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const { job } = await api<{ job: JobItem }>(`/api/projects/${projectId}/scripts`, {
        json: {
          environmentId,
          startPath,
          ...(which === "selected" && selected ? { testCaseIds: [selected.testCaseId] } : {}),
        },
      });
      onStarted(job);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't start.");
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="Write scripts"
        description="The assistant opens the app, captures each page of the flow and writes Playwright code with the real selectors. You review and approve every script."
      >
        <form onSubmit={start} className="flex flex-col gap-4">
          {error && <Alert tone="error">{error}</Alert>}
          {environments.length === 0 ? (
            <Alert tone="error">Add an environment first (Environments page).</Alert>
          ) : (
            <Field label="Read the pages from" htmlFor="write-env">
              <Select
                id="write-env"
                value={environmentId}
                onChange={(e) => setEnvironmentId(e.target.value)}
              >
                {environments.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                    {e.verified ? "" : " (unverified)"}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Which cases" htmlFor="write-which">
            <Select
              id="write-which"
              value={which}
              onChange={(e) => setWhich(e.target.value as typeof which)}
            >
              <option value="missing" disabled={missing === 0}>
                All approved cases without a script ({missing})
              </option>
              <option value="selected" disabled={!selected}>
                Rewrite {selected ? selected.key : "the selected script"}
              </option>
            </Select>
          </Field>
          <Field
            label="Start page"
            htmlFor="write-start"
            hint="Path where the tests begin, e.g. / or /leave/new"
          >
            <Input
              id="write-start"
              value={startPath}
              onChange={(e) => setStartPath(e.target.value)}
            />
          </Field>
          <Button type="submit" disabled={pending || environments.length === 0}>
            {pending ? "Starting…" : "Write scripts"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FixDialog({
  url,
  onClose,
  onStarted,
}: {
  url: string;
  onClose: () => void;
  onStarted: (job: JobItem) => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function start(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const { job } = await api<{ job: JobItem }>(url, {
        json: instruction.trim() ? { instruction: instruction.trim() } : {},
      });
      onStarted(job);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't start.");
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="Ask AI to fix"
        description="The AI fixes errors and elements missing from the page. The result is a new version for you to review."
      >
        <form onSubmit={start} className="flex flex-col gap-4">
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="What should change? (optional)" htmlFor="fix-instruction">
            <Textarea
              id="fix-instruction"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              maxLength={2000}
              placeholder="e.g. The Month filter is now a dropdown called Period"
            />
          </Field>
          <Button type="submit" disabled={pending}>
            {pending ? "Starting…" : "Fix it"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
