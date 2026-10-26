"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { RerunIcon } from "@/components/icons";
import { PageHeader } from "@/components/project/page-header";
import {
  CoverageCard,
  FailureList,
  ReportLists,
  ReportSummary,
  reportSubtitle,
} from "@/components/report/report-view";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api-client";
import { startDownload } from "@/lib/download";
import type { ExportItem, ReportData, ReportFailure } from "@/lib/types";
import { usePolling } from "@/lib/use-polling";
import { DefectDialog } from "./defect-dialog";
import { ShareDialog } from "./share-dialog";

const ACTIVE_RUN = ["QUEUED", "RUNNING", "PAUSED"];

export function ReportWorkspace({
  report,
  archived,
  can,
}: {
  report: ReportData;
  archived: boolean;
  can: { rerun: boolean; defect: boolean; analyse: boolean; exportFile: boolean; share: boolean };
}) {
  const router = useRouter();
  const { project, run } = report;
  const base = `/api/projects/${project.id}/runs/${run.id}`;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [exp, setExp] = useState<ExportItem | null>(null);
  const [defectFor, setDefectFor] = useState<ReportFailure | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  const runActive = ACTIVE_RUN.includes(run.status);
  const analysing = report.analysis?.status === "QUEUED" || report.analysis?.status === "RUNNING";
  const preparing = exp?.status === "QUEUED" || exp?.status === "RUNNING";

  // The likely causes arrive in the background: refresh until the analysis is done.
  const refresh = useCallback(async () => router.refresh(), [router]);
  usePolling(refresh, analysing || runActive, 4000);

  const pollExport = useCallback(async () => {
    if (!exp) return;
    const { exports } = await api<{ exports: ExportItem[] }>(`${base}/exports`);
    const fresh = exports.find((e) => e.id === exp.id);
    if (!fresh) return;
    setExp(fresh);
    if (fresh.status === "SUCCEEDED") {
      startDownload(`/api/projects/${project.id}/exports/${fresh.id}/file`);
    }
  }, [base, exp, project.id]);
  usePolling(pollExport, preparing, 1500);

  async function act(name: string, fn: () => Promise<void>) {
    setError(null);
    setBusy(name);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  const exportReport = (format: "PDF" | "HTML") =>
    act(`export-${format}`, async () => {
      const { export: created } = await api<{ export: ExportItem }>(`${base}/exports`, {
        json: { format },
      });
      setExp(created);
    });

  const rerun = (testCaseIds?: string[]) =>
    act(testCaseIds ? `rerun-${testCaseIds[0]}` : "rerun", async () => {
      const { run: next } = await api<{ run: { id: string } }>(`${base}/rerun`, {
        json: testCaseIds ? { testCaseIds } : {},
      });
      router.push(`/projects/${project.id}/runs/${next.id}`);
    });

  const analyse = () =>
    act("analyse", async () => {
      await api(`${base}/analysis`, { method: "POST" });
      router.refresh();
    });

  const failures = report.failures.length;
  const missingCauses = report.failures.some((f) => !f.likelyCause);

  return (
    <>
      <PageHeader
        crumbs={[
          { label: "Projects", href: "/projects" },
          { label: project.name, href: `/projects/${project.id}` },
          { label: "Runs", href: `/projects/${project.id}/runs` },
          { label: `Run #${run.number}` },
        ]}
        title={`Run #${run.number} report`}
        archived={archived}
        subtitle={reportSubtitle(report)}
        actions={
          <>
            <Button
              variant="secondary"
              disabled={!can.exportFile || runActive || preparing}
              onClick={() => void exportReport("PDF")}
            >
              Export PDF
            </Button>
            <Button variant="secondary" onClick={() => setShareOpen(true)}>
              Share link
            </Button>
            {can.rerun && failures > 0 && (
              <Button disabled={runActive || busy !== null} onClick={() => void rerun()}>
                <RerunIcon />
                Re-run {failures} failed
              </Button>
            )}
          </>
        }
      />

      {runActive && (
        <Alert title="This run is still going">
          The report fills in as tests finish.{" "}
          <Link href={`/projects/${project.id}/runs/${run.id}`}>Watch it live</Link>
        </Alert>
      )}
      {run.error && <Alert tone="error">{run.error}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
      {(preparing || exp?.status === "FAILED" || exp?.status === "SUCCEEDED") && (
        <p className="text-muted text-[13px]" role="status" aria-live="polite">
          {preparing
            ? `Preparing your ${exp?.format === "HTML" ? "HTML" : "PDF"} report…`
            : exp?.status === "FAILED"
              ? (exp.error ?? "The file couldn't be made. Please try again.")
              : "Your download has started."}
        </p>
      )}

      <ReportSummary totals={report.totals} />

      <div className="flex flex-wrap items-start gap-6">
        <FailureList
          report={report}
          screenshotUrl={(f) =>
            f.hasScreenshot ? `${base}/tests/${f.runTestId}/screenshot` : null
          }
          footer={
            report.analysis?.status === "FAILED" && missingCauses && failures > 0 ? (
              <Alert tone="error" title="Couldn't work out the likely causes">
                {report.analysis.error ?? "The analysis stopped early."}
                {can.analyse && (
                  <div className="mt-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy !== null}
                      onClick={() => void analyse()}
                    >
                      Try again
                    </Button>
                  </div>
                )}
              </Alert>
            ) : null
          }
          actions={(f) => (
            <>
              {f.defect ? (
                <Button size="sm" variant="secondary" asChild>
                  <Link href={`/projects/${project.id}/defects#${f.defect.key}`}>
                    See {f.defect.key}
                  </Link>
                </Button>
              ) : (
                can.defect && (
                  <Button size="sm" variant="soft" onClick={() => setDefectFor(f)}>
                    Log defect
                  </Button>
                )
              )}
              {f.hasTrace ? (
                <Button size="sm" variant="secondary" asChild>
                  <a href={`${base}/tests/${f.runTestId}/trace`} download>
                    Open trace
                  </a>
                </Button>
              ) : (
                <Button size="sm" variant="secondary" disabled title="No trace was recorded">
                  Open trace
                </Button>
              )}
              {can.rerun && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={runActive || busy !== null}
                  onClick={() => void rerun([f.testCaseId])}
                >
                  Re-run
                </Button>
              )}
            </>
          )}
        />
        <CoverageCard coverage={report.coverage} />
      </div>

      <ReportLists report={report} />

      {can.exportFile && !runActive && (
        <p className="text-muted text-[13px]">
          Need a file that opens anywhere?{" "}
          <button
            type="button"
            className="text-link font-semibold hover:underline disabled:opacity-50"
            disabled={preparing}
            onClick={() => void exportReport("HTML")}
          >
            Download the report as HTML
          </button>
        </p>
      )}

      {defectFor && (
        <DefectDialog
          projectId={project.id}
          failure={defectFor}
          onClose={() => setDefectFor(null)}
          onSaved={() => {
            setDefectFor(null);
            router.refresh();
          }}
        />
      )}
      <ShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        projectId={project.id}
        runId={run.id}
        canShare={can.share && !runActive}
      />
    </>
  );
}
