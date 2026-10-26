"use client";

import { useState } from "react";
import type * as React from "react";
import { ImageIcon } from "@/components/icons";
import { plural } from "@/lib/format";
import type {
  CoverageData,
  CoverageStatusName,
  DefectSeverityName,
  FailureCauseName,
  ReportData,
  ReportFailure,
} from "@/lib/types";
import { cn } from "@/lib/utils";

/** Design: three failure cards, then "Show all N failed and error cases". */
const FAILURES_SHOWN = 3;
/** Design: six coverage rows, then "See all N requirements". */
const COVERAGE_SHOWN = 6;

export const CAUSE_LABEL: Record<FailureCauseName, string> = {
  APP_BUG: "app bug",
  SCRIPT_ISSUE: "script issue",
  ENVIRONMENT: "environment",
  UNKNOWN: "unclear",
};

export const SEVERITY_LABEL: Record<DefectSeverityName, string> = {
  CRITICAL: "Critical",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
};

const COVERAGE_CHIP: Record<CoverageStatusName, { label: string; cls: string }> = {
  PASSING: { label: "Passing", cls: "bg-success-soft text-success" },
  FAILING: { label: "Failing", cls: "bg-warn-soft text-warn" },
  NOT_RUN: { label: "Not run yet", cls: "bg-amber-soft text-amber" },
  MANUAL: { label: "Manual", cls: "bg-accent-soft text-accent-strong" },
  NOT_COVERED: { label: "Not covered", cls: "bg-neutral-soft text-ink-2" },
};

export function durationLabel(ms: number | null): string {
  if (ms === null) return "—";
  const min = Math.round(ms / 60_000);
  return min < 1 ? `${Math.max(1, Math.round(ms / 1000))} s` : `${min} min`;
}

/** "Staging · Chromium · started by Ana · took 14 min" */
export function reportSubtitle(report: ReportData): string {
  return `${report.run.environment} · Chromium · started by ${report.run.triggeredBy} · took ${durationLabel(report.run.durationMs)}`;
}

export function ReportSummary({ totals }: { totals: ReportData["totals"] }) {
  const parts = [
    { n: totals.passed, label: "passed", bar: "bg-success-bar" },
    { n: totals.failed, label: "failed", bar: "bg-warn-bar" },
    { n: totals.errors, label: totals.errors === 1 ? "error" : "errors", bar: "bg-purple-bar" },
  ];
  const ran = totals.passed + totals.failed + totals.errors;
  return (
    <section
      aria-label="Summary"
      className="rounded-card border-line flex flex-col gap-[18px] border bg-white p-6"
    >
      <div className="flex flex-wrap items-baseline gap-3">
        <div className="text-[44px] leading-none font-bold">
          {totals.passRate === null ? "—" : `${totals.passRate}%`}
        </div>
        <div className="text-muted">
          of {plural(totals.automated, "automated test")} passed ·{" "}
          {totals.manual === 1 ? "1 case needs" : `${totals.manual} cases need`} manual checks
          {totals.skipped > 0 && ` · ${totals.skipped} skipped`}
        </div>
      </div>
      <div
        role="img"
        aria-label={parts.map((p) => `${p.n} ${p.label}`).join(", ")}
        className="flex h-3.5 gap-0.5 overflow-hidden rounded-full bg-white"
      >
        {ran === 0 ? (
          <div className="bg-neutral-soft flex-1" />
        ) : (
          parts
            .filter((p) => p.n > 0)
            .map((p) => <div key={p.label} className={p.bar} style={{ flex: `${p.n} 1 0` }} />)
        )}
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
        {parts.map((p) => (
          <div key={p.label} className="flex items-center gap-2.5">
            <span className={cn("size-3 rounded", p.bar)} aria-hidden />
            <span>
              <b>{p.n}</b> {p.label}
            </span>
          </div>
        ))}
        <div className="flex items-center gap-2.5">
          <span className="box-border size-3 rounded border-2 border-[#9AA2B4]" aria-hidden />
          <span>
            <b>{totals.manual}</b> manual
          </span>
        </div>
      </div>
    </section>
  );
}

function CauseLine({
  failure,
  analysis,
}: {
  failure: ReportFailure;
  analysis: ReportData["analysis"];
}) {
  if (failure.likelyCause) {
    return (
      <div className="text-accent-strong text-[13px]">
        <b>Likely cause:</b> {CAUSE_LABEL[failure.likelyCause]}
        {failure.causeExplanation ? ` — ${failure.causeExplanation}` : ""}
      </div>
    );
  }
  if (analysis && (analysis.status === "QUEUED" || analysis.status === "RUNNING")) {
    return (
      <div className="text-muted text-[13px]" role="status">
        Looking for the likely cause…
      </div>
    );
  }
  return null;
}

export function FailureCard({
  failure,
  analysis,
  screenshotUrl,
  actions,
}: {
  failure: ReportFailure;
  analysis: ReportData["analysis"];
  screenshotUrl: string | null;
  actions?: React.ReactNode;
}) {
  const isError = failure.status === "ERROR";
  return (
    <article className="rounded-card border-line flex flex-wrap gap-[18px] border bg-white p-[18px]">
      {screenshotUrl ? (
        <a
          href={screenshotUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="border-line block h-32 flex-[0_0_200px] overflow-hidden rounded-[10px] border"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- auth-scoped image route */}
          <img
            src={screenshotUrl}
            alt={`Screenshot at failure of ${failure.key}`}
            className="size-full object-cover object-top"
          />
        </a>
      ) : (
        <div className="bg-chip border-line text-muted flex h-32 flex-[0_0_200px] flex-col items-center justify-center gap-1.5 rounded-[10px] border text-xs">
          <ImageIcon size={26} />
          No screenshot
        </div>
      )}
      <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "rounded-full px-2.5 py-[3px] text-xs font-bold",
              isError ? "bg-purple-soft text-purple" : "bg-warn-soft text-warn",
            )}
          >
            {isError ? "Error" : "Failed"}
          </span>
          <span className="text-muted font-mono text-[13px]">
            {failure.key} · {failure.requirementKeys.join(", ") || "no requirement"}
          </span>
          {failure.attempts > 1 && (
            <span className="text-muted text-xs">after {failure.attempts} tries</span>
          )}
          {failure.defect && (
            <span className="bg-neutral-soft text-ink-2 rounded-full px-2.5 py-[3px] text-xs font-semibold">
              {failure.defect.key} · {failure.defect.status === "OPEN" ? "open" : "resolved"}
            </span>
          )}
        </div>
        <div className="text-base font-bold break-words">{failure.title}</div>
        <div className="bg-page text-ink-2 rounded-lg p-2.5 font-mono text-[12.5px] leading-normal break-words whitespace-pre-wrap">
          {failure.error ?? "No error message."}
        </div>
        <CauseLine failure={failure} analysis={analysis} />
        {actions && <div className="mt-1 flex flex-wrap gap-2">{actions}</div>}
      </div>
    </article>
  );
}

export function FailureList({
  report,
  screenshotUrl,
  actions,
  footer,
}: {
  report: ReportData;
  screenshotUrl: (f: ReportFailure) => string | null;
  actions?: (f: ReportFailure) => React.ReactNode;
  footer?: React.ReactNode;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? report.failures : report.failures.slice(0, FAILURES_SHOWN);
  return (
    <section className="flex min-w-0 flex-[999_1_560px] flex-col gap-3.5">
      <h2 className="m-0 text-[19px] font-bold">What needs your attention</h2>
      {footer}
      {report.failures.length === 0 ? (
        <div className="rounded-card border-line text-muted border bg-white p-[18px]">
          Nothing failed in this run.
        </div>
      ) : (
        shown.map((f) => (
          <FailureCard
            key={f.runTestId}
            failure={f}
            analysis={report.analysis}
            screenshotUrl={screenshotUrl(f)}
            actions={actions?.(f)}
          />
        ))
      )}
      {report.failures.length > FAILURES_SHOWN && (
        <button
          type="button"
          className="text-link self-start text-sm font-semibold hover:underline"
          aria-expanded={all}
          onClick={() => setAll(!all)}
        >
          {all ? "Show fewer" : `Show all ${report.failures.length} failed and error cases`}
        </button>
      )}
    </section>
  );
}

export function CoverageCard({ coverage }: { coverage: CoverageData }) {
  const [all, setAll] = useState(false);
  const pct = coverage.total ? Math.round((coverage.covered / coverage.total) * 100) : 0;
  const rows = all ? coverage.rows : coverage.rows.slice(0, COVERAGE_SHOWN);
  return (
    <section className="flex min-w-0 flex-[1_1_320px] flex-col gap-3.5">
      <h2 className="m-0 text-[19px] font-bold">Requirement coverage</h2>
      <div className="rounded-card border-line flex flex-col gap-3.5 border bg-white p-5">
        <div className="flex items-baseline justify-between">
          <span className="text-[26px] font-bold">
            {coverage.covered} / {coverage.total}
          </span>
          <span className="text-muted text-[13px]">requirements covered</span>
        </div>
        <div
          className="bg-neutral-soft h-2.5 overflow-hidden rounded-full"
          role="img"
          aria-label={`${pct}% of requirements covered`}
        >
          <div className="bg-accent h-2.5 rounded-full" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex flex-col">
          {coverage.total === 0 && (
            <p className="text-muted text-sm">This project has no requirements yet.</p>
          )}
          {rows.map((r) => {
            const chip = COVERAGE_CHIP[r.status];
            return (
              <div
                key={r.id}
                className="border-line-soft flex items-center gap-2.5 border-t py-2.5"
              >
                <span className="text-muted shrink-0 font-mono text-[12.5px]">{r.key}</span>
                <span
                  className="min-w-0 flex-auto truncate text-sm"
                  title={`${r.text}${r.cases.length ? ` — ${r.cases.map((c) => c.key).join(", ")}` : ""}`}
                >
                  {r.text}
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold",
                    chip.cls,
                  )}
                >
                  {chip.label}
                </span>
              </div>
            );
          })}
        </div>
        {coverage.total > COVERAGE_SHOWN && (
          <button
            type="button"
            className="text-link self-start text-sm font-semibold hover:underline"
            aria-expanded={all}
            onClick={() => setAll(!all)}
          >
            {all ? "Show fewer" : `See all ${coverage.total} requirements`}
          </button>
        )}
      </div>
    </section>
  );
}

/** FR-4.4 / FR-9.1: manual-only cases and the passed list, folded away under the main view. */
export function ReportLists({ report }: { report: ReportData }) {
  return (
    <div className="flex flex-col gap-3">
      <details className="rounded-card border-line border bg-white p-5">
        <summary className="cursor-pointer font-bold">
          Manual checks ({report.manualCases.length})
        </summary>
        {report.manualCases.length === 0 ? (
          <p className="text-muted mt-3 text-sm">Every approved case runs automatically.</p>
        ) : (
          <ul className="mt-3 flex list-none flex-col gap-2 p-0">
            {report.manualCases.map((m) => (
              <li key={m.id} className="text-sm">
                <span className="text-muted font-mono text-[12.5px]">{m.key}</span> {m.title}
                {m.automatableReason && (
                  <span className="text-muted"> — {m.automatableReason}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </details>
      <details className="rounded-card border-line border bg-white p-5">
        <summary className="cursor-pointer font-bold">Passed ({report.passedCases.length})</summary>
        {report.passedCases.length === 0 ? (
          <p className="text-muted mt-3 text-sm">No test passed in this run.</p>
        ) : (
          <ul className="mt-3 flex list-none flex-col gap-2 p-0">
            {report.passedCases.map((p) => (
              <li key={p.key} className="text-sm">
                <span className="text-muted font-mono text-[12.5px]">{p.key}</span> {p.title}
                {p.status === "SKIPPED" ? (
                  <span className="text-muted"> (skipped)</span>
                ) : (
                  p.durationMs !== null && (
                    <span className="text-muted"> · {durationLabel(p.durationMs)}</span>
                  )
                )}
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}
