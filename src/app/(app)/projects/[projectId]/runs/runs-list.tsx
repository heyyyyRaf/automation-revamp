"use client";

import Link from "next/link";
import { useState } from "react";
import { PlayIcon } from "@/components/icons";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { activityLabel } from "@/lib/format";
import type { RunListItem, RunStatusName } from "@/lib/types";
import { RunDialog, type RunTargets } from "./run-dialog";

const STATUS: Record<RunStatusName, { label: string; tone: BadgeTone }> = {
  QUEUED: { label: "Waiting", tone: "neutral" },
  RUNNING: { label: "Running", tone: "info" },
  PAUSED: { label: "Paused", tone: "warning" },
  PASSED: { label: "Passed", tone: "success" },
  FAILED: { label: "Failed", tone: "warning" },
  ERROR: { label: "Error", tone: "warning" },
  CANCELLED: { label: "Stopped", tone: "neutral" },
  ABORTED: { label: "Aborted", tone: "warning" },
};

const ACTIVE: RunStatusName[] = ["QUEUED", "RUNNING", "PAUSED"];

export function RunsList({
  projectId,
  runs,
  targets,
  canRun,
}: {
  projectId: string;
  runs: RunListItem[];
  targets: RunTargets;
  canRun: boolean;
}) {
  const [starting, setStarting] = useState(false);
  return (
    <section aria-labelledby="runs-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="runs-heading" className="text-[19px] font-bold">
          Runs
        </h2>
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" asChild>
            <Link href={`/projects/${projectId}/defects`}>Defects</Link>
          </Button>
          {canRun && (
            <Button onClick={() => setStarting(true)}>
              <PlayIcon /> Run and watch
            </Button>
          )}
        </div>
      </div>
      {runs.length === 0 ? (
        <EmptyState
          icon={<PlayIcon />}
          title="No run yet"
          description="Approve test cases and their scripts, verify an environment, then run them and watch live."
        />
      ) : (
        <div className="border-line rounded-card overflow-x-auto border bg-white">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="text-muted text-left text-xs tracking-[0.04em] uppercase">
                <th className="px-4 py-3.5 font-semibold">Run</th>
                <th className="px-2 py-3.5 font-semibold">Status</th>
                <th className="px-2 py-3.5 font-semibold">Results</th>
                <th className="px-2 py-3.5 font-semibold">Environment</th>
                <th className="px-2 py-3.5 font-semibold">Started</th>
                <th className="px-4 py-3.5 font-semibold">
                  <span className="sr-only">Report</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-line-soft border-t">
                  <td className="px-4 py-3.5">
                    <Link href={`/projects/${projectId}/runs/${r.id}`} className="font-semibold">
                      Run #{r.number}
                    </Link>
                  </td>
                  <td className="px-2 py-3.5">
                    <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                  </td>
                  <td className="text-ink-2 px-2 py-3.5 text-[13px]">
                    {r.passed} passed · {r.failed + r.errors} failed
                    {r.skipped > 0 && ` · ${r.skipped} skipped`} of {r.total}
                  </td>
                  <td className="text-ink-2 px-2 py-3.5 text-[13px]">{r.environment}</td>
                  <td className="text-muted px-2 py-3.5 text-[13px]" suppressHydrationWarning>
                    {activityLabel("", r.createdAt).trim()} · {r.triggeredBy}
                  </td>
                  <td className="px-4 py-3.5 text-right text-[13px]">
                    {!ACTIVE.includes(r.status) && (
                      <Link
                        href={`/projects/${projectId}/runs/${r.id}/report`}
                        className="font-semibold"
                      >
                        Report
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {starting && (
        <RunDialog projectId={projectId} targets={targets} onClose={() => setStarting(false)} />
      )}
    </section>
  );
}
