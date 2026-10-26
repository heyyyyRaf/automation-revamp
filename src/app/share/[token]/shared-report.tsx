"use client";

import { CheckIcon } from "@/components/icons";
import {
  CoverageCard,
  FailureList,
  ReportLists,
  ReportSummary,
  reportSubtitle,
} from "@/components/report/report-view";
import type { DateLike, ReportData } from "@/lib/types";

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** The report as a guest sees it: read-only, no actions, no links into the app. */
export function SharedReport({
  token,
  report,
  expiresAt,
}: {
  token: string;
  report: ReportData;
  expiresAt: DateLike;
}) {
  return (
    <main className="mx-auto box-border flex max-w-[1240px] flex-col gap-6 px-4 py-8 sm:px-10">
      <div className="flex items-center gap-2.5">
        <span className="bg-accent flex size-9 items-center justify-center rounded-[10px] text-white">
          <CheckIcon size={20} />
        </span>
        <span className="text-[17px] font-bold">Traxion QA</span>
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-muted text-sm">{report.project.name}</p>
        <h1 className="text-[28px] font-bold">Run #{report.run.number} report</h1>
        <p className="text-muted">{reportSubtitle(report)}</p>
        <p className="text-muted text-[13px]">
          Shared read-only link · stops working {dateTime.format(new Date(expiresAt))}
        </p>
      </div>
      <ReportSummary totals={report.totals} />
      <div className="flex flex-wrap items-start gap-6">
        <FailureList
          report={report}
          screenshotUrl={(f) =>
            f.hasScreenshot
              ? `/api/share/${encodeURIComponent(token)}/screenshots/${f.runTestId}`
              : null
          }
        />
        <CoverageCard coverage={report.coverage} />
      </div>
      <ReportLists report={report} />
    </main>
  );
}
