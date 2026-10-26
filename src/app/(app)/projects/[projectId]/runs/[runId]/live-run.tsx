"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/project/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api-client";
import { plural } from "@/lib/format";
import type {
  LiveEventItem,
  ResultStatusName,
  RunDetailItem,
  RunStatusName,
  RunStepItem,
  RunTestItem,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const ACTIVE: RunStatusName[] = ["QUEUED", "RUNNING", "PAUSED"];

const RUN_CHIP: Record<RunStatusName, { label: string; cls: string }> = {
  QUEUED: { label: "Waiting to start", cls: "bg-neutral-soft text-ink-2" },
  RUNNING: { label: "Running", cls: "bg-accent-soft text-accent-strong" },
  PAUSED: { label: "Paused", cls: "bg-warn-faint text-warn" },
  PASSED: { label: "Passed", cls: "bg-success-soft text-success" },
  FAILED: { label: "Failed", cls: "bg-warn-soft text-warn" },
  ERROR: { label: "Error", cls: "bg-warn-soft text-warn" },
  CANCELLED: { label: "Stopped", cls: "bg-neutral-soft text-ink-2" },
  ABORTED: { label: "Aborted", cls: "bg-warn-soft text-warn" },
};

const MARK: Record<ResultStatusName, { mark: string; cls: string }> = {
  PASSED: { mark: "✓", cls: "bg-success-soft text-success" },
  FAILED: { mark: "✕", cls: "bg-warn-soft text-warn" },
  ERROR: { mark: "!", cls: "bg-warn-soft text-warn" },
  RUNNING: { mark: "•", cls: "bg-accent-soft text-accent-strong" },
  PENDING: { mark: "", cls: "bg-neutral-soft text-muted" },
  SKIPPED: { mark: "–", cls: "bg-neutral-soft text-muted" },
};

interface ConsoleLine {
  level: string;
  text: string;
}
interface NetLine {
  method: string;
  url: string;
  status: number | null;
  durationMs: number | null;
  failed: boolean;
}

/** "Click getByRole('button', { name: 'Submit' })" → ["Click", "getByRole(…)"]. */
function splitTitle(title: string): [string, string] {
  const i = title.indexOf(" ");
  return i < 0 ? [title, ""] : [title.slice(0, i), title.slice(i + 1)];
}

function ms(n: number | null): string {
  if (n === null) return "";
  return n < 1000 ? `${n} ms` : `${(n / 1000).toFixed(1)} s`;
}

/** Design: "Run #12 · watching live". Updates arrive as server-sent events. */
export function LiveRun({
  projectId,
  projectName,
  initialRun,
  canControl,
}: {
  projectId: string;
  projectName: string;
  initialRun: RunDetailItem;
  canControl: boolean;
}) {
  const [run, setRun] = useState(initialRun);
  const [followId, setFollowId] = useState<string | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [pickedStep, setPickedStep] = useState<string | null>(null);
  const [frames, setFrames] = useState<Record<string, string>>({});
  const [current, setCurrent] = useState<Record<string, string>>({});
  const [consoleLines, setConsole] = useState<Record<string, ConsoleLine[]>>({});
  const [netLines, setNet] = useState<Record<string, NetLine[]>>({});
  const [slow, setSlow] = useState(initialRun.slowMotion);
  const [tab, setTab] = useState<"actions" | "console" | "network">("actions");
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const base = `/api/projects/${projectId}/runs/${run.id}`;
  const active = ACTIVE.includes(run.status);
  // A clock for the "about N min left" estimate, ticking only while the run is active.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now());
    const id = setInterval(tick, 5000);
    const first = setTimeout(tick, 0);
    return () => {
      clearInterval(id);
      clearTimeout(first);
    };
  }, [active]);

  const reload = useCallback(async () => {
    const res = await api<{ run: RunDetailItem }>(base);
    setRun(res.run);
  }, [base]);

  useEffect(() => {
    if (!ACTIVE.includes(initialRun.status)) return;
    const source = new EventSource(`${base}/live`);
    source.onopen = () => {
      setConnected(true);
      // Catch up with anything that happened before the stream opened.
      void reload().catch(() => undefined);
    };
    source.onerror = () => setConnected(false);
    source.onmessage = (msg) => {
      let e: LiveEventItem;
      try {
        e = JSON.parse(msg.data as string) as LiveEventItem;
      } catch {
        return;
      }
      switch (e.type) {
        case "run":
          setRun((r) => ({
            ...r,
            status: e.status,
            error: e.error,
            counts: { passed: e.passed, failed: e.failed, errors: e.errors, skipped: e.skipped },
          }));
          break;
        case "paused":
          setRun((r) => ({ ...r, status: "PAUSED" }));
          break;
        case "resumed":
          setRun((r) => ({ ...r, status: "RUNNING" }));
          break;
        case "speed":
          setSlow(e.slow);
          break;
        case "test":
          setRun((r) => ({
            ...r,
            tests: r.tests.map((t) =>
              t.id === e.runTestId
                ? {
                    ...t,
                    status: e.status,
                    durationMs: e.durationMs,
                    error: e.error,
                    ...(e.status === "RUNNING" && t.status !== "RUNNING" ? { steps: [] } : {}),
                  }
                : t,
            ),
          }));
          if (e.status === "RUNNING") setFollowId(e.runTestId);
          break;
        case "step-begin":
          setCurrent((c) => ({ ...c, [e.runTestId]: e.title }));
          break;
        case "step":
          setRun((r) => ({
            ...r,
            tests: r.tests.map((t) =>
              t.id === e.runTestId
                ? { ...t, steps: [...t.steps.filter((s) => s.id !== e.step.id), e.step] }
                : t,
            ),
          }));
          setCurrent((c) => {
            const next = { ...c };
            delete next[e.runTestId];
            return next;
          });
          break;
        case "frame":
          setFrames((f) => ({ ...f, [e.runTestId]: e.jpeg }));
          break;
        case "console":
          setConsole((c) => ({
            ...c,
            [e.runTestId]: [...(c[e.runTestId] ?? []), { level: e.level, text: e.text }].slice(
              -300,
            ),
          }));
          break;
        case "net":
          setNet((n) => ({ ...n, [e.runTestId]: [...(n[e.runTestId] ?? []), e].slice(-300) }));
          break;
        case "end":
          source.close();
          setConnected(false);
          void reload();
          break;
        default:
          break;
      }
    };
    return () => source.close();
  }, [base, initialRun.status, reload]);

  async function control(action: "pause" | "resume" | "stop" | "slow" | "normal") {
    setError(null);
    try {
      await api(`${base}/control`, { json: { action } });
      if (action === "slow" || action === "normal") setSlow(action === "slow");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That didn't work.");
    }
  }

  const tests = run.tests;
  const selectedId =
    pickedId ??
    followId ??
    tests.find((t) => t.status === "RUNNING")?.id ??
    tests.find((t) => t.status === "FAILED" || t.status === "ERROR")?.id ??
    tests[0]?.id ??
    null;
  const selected: RunTestItem | null = tests.find((t) => t.id === selectedId) ?? null;
  // Finished tests: show the stored console and network logs inline.
  useEffect(() => {
    const t = run.tests.find((x) => x.id === selectedId) ?? null;
    if (!t || ACTIVE.includes(run.status)) return;
    let cancelled = false;
    if (tab === "console" && t.has.console && !consoleLines[t.id]) {
      api<ConsoleLine[]>(`${base}/tests/${t.id}/console`)
        .then((lines) => !cancelled && setConsole((c) => ({ ...c, [t.id]: lines })))
        .catch(() => undefined);
    }
    if (tab === "network" && t.has.network && !netLines[t.id]) {
      api<NetLine[]>(`${base}/tests/${t.id}/network`)
        .then((lines) => !cancelled && setNet((n) => ({ ...n, [t.id]: lines })))
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [tab, selectedId, run.tests, run.status, base, consoleLines, netLines]);

  const steps = useMemo(
    () => [...(selected?.steps ?? [])].sort((a, b) => a.index - b.index),
    [selected?.steps],
  );
  // A finished test shows the page after its last step unless a step is picked.
  const step: RunStepItem | null =
    steps.find((s) => s.id === pickedStep) ??
    (selected && selected.status !== "RUNNING"
      ? ([...steps].reverse().find((s) => s.hasScreenshot) ?? null)
      : null);

  const done = tests.filter((t) => ["PASSED", "FAILED", "ERROR", "SKIPPED"].includes(t.status));
  const running = tests.filter((t) => t.status === "RUNNING");
  const passed = tests.filter((t) => t.status === "PASSED").length;
  const failed = tests.filter((t) => t.status === "FAILED" || t.status === "ERROR").length;
  const pct = (n: number) => (tests.length ? `${(n / tests.length) * 100}%` : "0%");
  const elapsed =
    now !== null && run.startedAt ? (now - new Date(run.startedAt).getTime()) / 1000 : 0;
  const eta =
    active && elapsed > 0 && done.length > 0 && done.length < tests.length
      ? Math.round(
          ((elapsed / done.length) * (tests.length - done.length)) / Math.max(1, run.workers) / 60,
        )
      : null;

  const liveTitle = selected ? current[selected.id] : undefined;
  const lastStep = steps.at(-1);
  const [verb, target] = splitTitle(
    step?.title ??
      liveTitle ??
      lastStep?.title ??
      (selected?.status === "PENDING" ? "Waiting" : ""),
  );
  const imageSrc = step?.hasScreenshot
    ? `${base}/steps/${step.id}/screenshot`
    : selected && frames[selected.id]
      ? `data:image/jpeg;base64,${frames[selected.id]}`
      : null;
  const chip = RUN_CHIP[run.status];

  return (
    <>
      <PageHeader
        crumbs={[
          { label: "Projects", href: "/projects" },
          { label: projectName, href: `/projects/${projectId}` },
          { label: "Runs", href: `/projects/${projectId}/runs` },
          { label: `Run #${run.number}` },
        ]}
        title={active ? `Run #${run.number} · watching live` : `Run #${run.number}`}
        subtitle={
          <span
            className={cn(
              "inline-flex items-center gap-2 rounded-full px-3 py-1 text-[13px] font-bold",
              chip.cls,
            )}
          >
            <span className="size-2 rounded-full bg-current" aria-hidden />
            {chip.label}
          </span>
        }
        actions={
          <>
            {canControl && active && (
              <label className="border-control inline-flex h-11 cursor-pointer items-center gap-2 rounded-[10px] border bg-white px-3.5 text-sm font-semibold">
                <input
                  type="checkbox"
                  className="accent-accent size-[18px]"
                  checked={slow}
                  onChange={(e) => void control(e.target.checked ? "slow" : "normal")}
                />
                Slow motion
              </label>
            )}
            {canControl && run.status === "RUNNING" && (
              <Button variant="secondary" onClick={() => void control("pause")}>
                Pause
              </Button>
            )}
            {canControl && run.status === "PAUSED" && (
              <Button variant="secondary" onClick={() => void control("resume")}>
                Resume
              </Button>
            )}
            {canControl && active && (
              <Button
                variant="warn"
                onClick={() => {
                  if (window.confirm("Stop this run? Tests already finished are kept."))
                    void control("stop");
                }}
              >
                Stop run
              </Button>
            )}
            <Button disabled aria-describedby="report-later">
              Open report
            </Button>
            <span id="report-later" className="sr-only">
              The report arrives in the next phase of the build.
            </span>
          </>
        }
      />

      {error && <Alert tone="error">{error}</Alert>}
      {run.error && <Alert tone="error">{run.error}</Alert>}
      {active && !connected && (
        <p className="text-muted text-[13px]" role="status">
          Connecting to the live view…
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap justify-between gap-2 text-[13px]">
          <span className="font-semibold">
            {done.length} of {plural(tests.length, "test")} done · {passed} passed · {failed} failed
            {running.length > 0 && ` · ${running.length} running now`}
          </span>
          <span className="text-muted">
            Chromium · {run.environment.name}
            {run.workers > 1 && ` · ${run.workers} in parallel`}
            {eta !== null && ` · about ${eta < 1 ? "1" : eta} min left`}
          </span>
        </div>
        <div
          className="bg-line flex h-2 overflow-hidden rounded-full"
          role="img"
          aria-label={`${done.length} of ${tests.length} tests done`}
        >
          <div className="bg-success-bar" style={{ width: pct(passed) }} />
          <div className="bg-warn-bar" style={{ width: pct(failed) }} />
          <div className="bg-accent" style={{ width: pct(running.length) }} />
        </div>
      </div>

      <div className="flex flex-wrap items-stretch gap-4">
        <section
          aria-label="Tests in this run"
          className="border-line rounded-card flex min-w-0 flex-[1_1_230px] flex-col gap-0.5 border bg-white p-2.5"
        >
          <div className="text-muted px-2 pt-1.5 pb-2.5 text-xs font-bold tracking-[0.04em] uppercase">
            Tests
          </div>
          {tests.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setPickedId(t.id);
                setPickedStep(null);
              }}
              aria-pressed={t.id === selectedId}
              className={cn(
                "flex min-h-10 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left",
                t.id === selectedId ? "bg-accent-soft" : "hover:bg-page",
              )}
            >
              <span
                className={cn(
                  "inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                  MARK[t.status].cls,
                )}
                aria-hidden
              >
                {MARK[t.status].mark}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span
                  className={cn(
                    "truncate text-[13px]",
                    t.status === "RUNNING" ? "font-bold" : "font-medium",
                  )}
                >
                  {t.title}
                </span>
                <span className="text-muted font-mono text-[11px]">
                  {t.key} ·{" "}
                  {t.status === "RUNNING"
                    ? "running"
                    : t.status === "PENDING"
                      ? "queued"
                      : t.durationMs !== null
                        ? ms(t.durationMs)
                        : t.status.toLowerCase()}
                  {t.attempts > 1 && ` · ${t.attempts} tries`}
                </span>
              </span>
            </button>
          ))}
        </section>

        <section
          aria-label="Live browser"
          className="flex min-w-0 flex-[999_1_480px] flex-col gap-3"
        >
          <div className="border-control rounded-card flex flex-col overflow-hidden border bg-white">
            <div className="border-control flex items-center gap-3 border-b bg-[#EEF0F5] px-3.5 py-2.5">
              <div aria-hidden className="flex gap-1.5">
                <span className="size-[11px] rounded-full bg-[#C9CEDA]" />
                <span className="size-[11px] rounded-full bg-[#C9CEDA]" />
                <span className="size-[11px] rounded-full bg-[#C9CEDA]" />
              </div>
              <div className="text-ink-2 flex h-[30px] min-w-0 flex-1 items-center overflow-hidden rounded-lg bg-white px-3 font-mono text-xs whitespace-nowrap">
                {run.environment.baseUrl}
              </div>
              {selected && <span className="text-muted text-xs font-semibold">{selected.key}</span>}
            </div>
            <div className="flex items-center gap-2.5 overflow-x-auto bg-[#1E2332] px-4 py-2.5 font-mono text-[12.5px] whitespace-nowrap text-[#E6E9F2]">
              <span className="font-semibold text-[#8CC8FF]">{verb || " "}</span>
              <span>{target}</span>
            </div>
            <div className="flex min-h-[380px] items-center justify-center bg-[#FAFBFD] p-4">
              {imageSrc ? (
                // eslint-disable-next-line @next/next/no-img-element -- live frames are data: URLs
                <img
                  src={imageSrc}
                  alt={step ? `The page after: ${step.title}` : "The page right now"}
                  className="border-line max-h-[520px] max-w-full rounded-lg border"
                />
              ) : (
                <p className="text-muted text-sm">
                  {selected?.status === "PENDING"
                    ? "This test hasn't started yet."
                    : "No picture yet."}
                </p>
              )}
            </div>
          </div>
          {steps.length > 0 && (
            <>
              <div
                aria-label="Step timeline"
                className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2"
              >
                {steps.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setPickedStep(s.id === pickedStep ? null : s.id)}
                    aria-pressed={s.id === pickedStep}
                    className={cn(
                      "flex min-h-14 flex-col gap-1 rounded-[10px] bg-white p-2 text-left",
                      s.id === pickedStep ? "border-accent border-2" : "border-line border",
                    )}
                  >
                    <span
                      className={cn(
                        "h-1 rounded-sm",
                        s.status === "PASSED" ? "bg-success-bar" : "bg-warn-bar",
                      )}
                    />
                    <span className="truncate text-xs font-semibold">{splitTitle(s.title)[0]}</span>
                  </button>
                ))}
              </div>
              <p className="text-muted text-xs">
                Click a step to see the page as it was at that moment.
              </p>
            </>
          )}
        </section>

        <section
          aria-label="Actions"
          className="border-line rounded-card flex min-w-0 flex-[1_1_280px] flex-col overflow-hidden border bg-white"
        >
          <div role="tablist" className="border-line-soft flex border-b">
            {(
              [
                ["actions", "Actions"],
                ["console", "Console"],
                ["network", "Network"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={cn(
                  "h-11 flex-1 border-b-2 text-[13px]",
                  tab === key
                    ? "border-accent text-accent-strong font-bold"
                    : "text-muted border-transparent",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div role="tabpanel" className="flex max-h-[520px] flex-col overflow-y-auto p-2">
            {tab === "actions" &&
              (steps.length === 0 ? (
                <p className="text-muted p-2.5 text-[13px]">No action yet.</p>
              ) : (
                steps.map((s) => {
                  const [v, t] = splitTitle(s.title);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setPickedStep(s.id)}
                      className={cn(
                        "flex items-start gap-2.5 rounded-lg p-2.5 text-left",
                        s.id === pickedStep ? "bg-accent-soft" : "hover:bg-page",
                      )}
                    >
                      <span
                        className={cn(
                          "inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                          s.status === "PASSED"
                            ? "bg-success-soft text-success"
                            : "bg-warn-soft text-warn",
                        )}
                        aria-hidden
                      >
                        {s.status === "PASSED" ? "✓" : "!"}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="font-mono text-[12.5px] font-semibold">{v}</span>
                        <span className="text-muted font-mono text-[11.5px] [overflow-wrap:anywhere]">
                          {t}
                        </span>
                        {s.error && (
                          <span className="text-warn text-xs">{s.error.split("\n")[0]}</span>
                        )}
                      </span>
                      <span className="text-muted shrink-0 text-[11.5px]">{ms(s.durationMs)}</span>
                    </button>
                  );
                })
              ))}
            {tab === "console" && (
              <LogList
                empty="No console messages."
                lines={(selected && consoleLines[selected.id]) ?? []}
                render={(l: ConsoleLine) => (
                  <span
                    className={cn(
                      "font-mono text-[11.5px] [overflow-wrap:anywhere]",
                      l.level === "error"
                        ? "text-warn"
                        : l.level === "warning"
                          ? "text-warn-ink"
                          : "text-ink-2",
                    )}
                  >
                    [{l.level}] {l.text}
                  </span>
                )}
                downloadHref={selected?.has.console ? `${base}/tests/${selected.id}/console` : null}
              />
            )}
            {tab === "network" && (
              <LogList
                empty="No requests recorded."
                lines={(selected && netLines[selected.id]) ?? []}
                render={(n: NetLine) => (
                  <span
                    className={cn(
                      "flex gap-2 font-mono text-[11.5px]",
                      n.failed || (n.status ?? 0) >= 400 ? "text-warn" : "text-ink-2",
                    )}
                  >
                    <span className="font-semibold">{n.method}</span>
                    <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{n.url}</span>
                    <span>{n.failed ? "failed" : n.status}</span>
                    <span className="text-muted">{ms(n.durationMs)}</span>
                  </span>
                )}
                downloadHref={selected?.has.network ? `${base}/tests/${selected.id}/network` : null}
              />
            )}
          </div>
          <div className="border-line-soft mt-auto flex flex-col gap-1.5 border-t p-3.5">
            <div className="text-muted text-xs font-bold tracking-[0.04em] uppercase">
              {selected?.status === "RUNNING"
                ? "Looking for"
                : selected?.error
                  ? "What went wrong"
                  : "Status"}
            </div>
            <p className="text-[13px] leading-normal [overflow-wrap:anywhere]">
              {selected?.status === "RUNNING"
                ? (liveTitle ?? "Waiting for the next action…")
                : selected?.error
                  ? selected.error.split("\n").slice(0, 3).join(" ")
                  : selected
                    ? `${selected.status.charAt(0)}${selected.status.slice(1).toLowerCase()}`
                    : ""}
            </p>
            {selected && !active && (
              <div className="flex flex-wrap gap-2 pt-1">
                {selected.has.trace && (
                  <a
                    className="text-[13px] font-semibold"
                    href={`${base}/tests/${selected.id}/trace`}
                  >
                    Trace
                  </a>
                )}
                {selected.has.screenshot && (
                  <a
                    className="text-[13px] font-semibold"
                    href={`${base}/tests/${selected.id}/screenshot`}
                  >
                    Failure screenshot
                  </a>
                )}
                {selected.has.log && (
                  <a
                    className="text-[13px] font-semibold"
                    href={`${base}/tests/${selected.id}/log`}
                  >
                    Runner log
                  </a>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function LogList<T>({
  lines,
  render,
  empty,
  downloadHref,
}: {
  lines: T[];
  render: (line: T) => React.ReactNode;
  empty: string;
  downloadHref: string | null;
}) {
  return (
    <div className="flex flex-col gap-1 p-1.5">
      {lines.length === 0 ? (
        <p className="text-muted p-1 text-[13px]">
          {downloadHref ? "Recorded — download to see it." : empty}
        </p>
      ) : (
        lines.map((l, i) => <div key={i}>{render(l)}</div>)
      )}
      {downloadHref && (
        <a href={downloadHref} className="mt-1 text-[13px] font-semibold">
          Download
        </a>
      )}
    </div>
  );
}
