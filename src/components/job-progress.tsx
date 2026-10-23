import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { isJobActive, type JobItem } from "@/lib/types";

/** Plain-language status of a background job. */
export function JobProgress({
  job,
  runningLabel,
  doneLabel,
}: {
  job: JobItem | null;
  runningLabel: string;
  doneLabel: (job: JobItem) => string;
}) {
  if (!job) return null;
  if (isJobActive(job)) {
    return (
      <div className="flex flex-col gap-2" role="status" aria-live="polite">
        <p className="flex items-center gap-2 text-slate-700">
          <Loader2 className="text-accent size-5 animate-spin" aria-hidden />
          {job.status === "QUEUED" ? "Waiting to start…" : runningLabel}
          {job.error && <span className="text-sm text-amber-700">({job.error})</span>}
        </p>
        <div className="h-2 w-full max-w-md overflow-hidden rounded-full bg-slate-200">
          <div
            className="bg-accent h-full rounded-full transition-all"
            style={{ width: `${Math.max(5, job.progress)}%` }}
          />
        </div>
      </div>
    );
  }
  if (job.status === "FAILED") {
    return (
      <p className="flex items-start gap-2 text-red-700" role="alert">
        <AlertCircle className="mt-0.5 size-5 shrink-0" aria-hidden />
        <span>{job.error ?? "This didn't work. Please try again."}</span>
      </p>
    );
  }
  if (job.status === "SUCCEEDED") {
    return (
      <p className="flex items-center gap-2 text-emerald-700" role="status">
        <CheckCircle2 className="size-5" aria-hidden />
        {doneLabel(job)}
      </p>
    );
  }
  return null;
}

export function resultNumber(job: JobItem, key: string): number {
  const r = job.result as Record<string, unknown> | null;
  const v = r?.[key];
  return typeof v === "number" ? v : 0;
}
