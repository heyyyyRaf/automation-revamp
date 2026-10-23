"use client";

import { ArrowRight, Sparkles } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { JobProgress, resultNumber } from "@/components/job-progress";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, ApiError } from "@/lib/api-client";
import { isJobActive, type AiBudgetItem, type JobItem } from "@/lib/types";
import { usePolling } from "@/lib/use-polling";
import { AiUsage } from "./ai-usage";

export function AnalysisPanel({
  projectId,
  initialJob,
  initialBudget,
  canRun,
  canEditBudget,
  hasInput,
}: {
  projectId: string;
  initialJob: JobItem | null;
  initialBudget: AiBudgetItem;
  canRun: boolean;
  canEditBudget: boolean;
  hasInput: boolean;
}) {
  const [job, setJob] = useState(initialJob);
  const [budget, setBudget] = useState(initialBudget);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const base = `/api/projects/${projectId}`;

  const refresh = useCallback(async () => {
    const [{ jobs }, b] = await Promise.all([
      api<{ jobs: JobItem[] }>(`${base}/jobs?types=ANALYZE_REQUIREMENTS`),
      api<{ budget: AiBudgetItem }>(`${base}/ai-budget`),
    ]);
    setJob(jobs[0] ?? null);
    setBudget(b.budget);
  }, [base]);
  usePolling(refresh, isJobActive(job));

  async function start() {
    setPending(true);
    setError(null);
    try {
      const res = await api<{ job: JobItem }>(`${base}/analysis`, { method: "POST" });
      setJob(res.job);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't start the analysis.");
    } finally {
      setPending(false);
    }
  }

  const running = isJobActive(job);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Step 2 · Analyze requirements with AI</CardTitle>
        <CardDescription>
          AI reads your documents and diagrams and lists each requirement, user flow and open
          question. Running it again only adds new findings — your edits are never overwritten.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && <Alert tone="error">{error}</Alert>}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="lg"
            onClick={() => void start()}
            disabled={!canRun || !hasInput || running || pending}
          >
            <Sparkles aria-hidden /> {job ? "Analyze again" : "Analyze requirements"}
          </Button>
          {job?.status === "SUCCEEDED" && (
            <Button size="lg" variant="secondary" asChild>
              <Link href={`/projects/${projectId}/requirements`}>
                Review requirements <ArrowRight aria-hidden />
              </Link>
            </Button>
          )}
          {!hasInput && (
            <p className="text-sm text-slate-500">Upload a document, diagram or design first.</p>
          )}
          {!canRun && hasInput && (
            <p className="text-sm text-slate-500">
              Only QA Testers and Admins can run AI analysis.
            </p>
          )}
        </div>
        <JobProgress
          job={job}
          runningLabel="Reading your documents… this can take a few minutes."
          doneLabel={(j) =>
            `Done: ${resultNumber(j, "requirementsAdded")} new requirements, ${resultNumber(j, "flowsAdded")} flows and ${resultNumber(j, "questionsAdded")} questions${resultNumber(j, "duplicatesSkipped") ? ` (${resultNumber(j, "duplicatesSkipped")} duplicates skipped)` : ""}.`
          }
        />
        <AiUsage
          projectId={projectId}
          budget={budget}
          onChange={setBudget}
          canEdit={canEditBudget}
        />
      </CardContent>
    </Card>
  );
}
