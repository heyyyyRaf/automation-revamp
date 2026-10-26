import type { Metadata } from "next";
import { can } from "@/lib/permissions";
import { requireAuthPage } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-guard";
import { getProject } from "@/server/services/projects";
import { getRunReport } from "@/server/services/reports";
import { ReportWorkspace } from "./report-workspace";

export const metadata: Metadata = { title: "Run report" };

/** Design: "Run #12 report" (FR-9). */
export default async function ReportPage({
  params,
}: {
  params: Promise<{ projectId: string; runId: string }>;
}) {
  const { projectId, runId } = await params;
  const auth = await requireAuthPage();
  const project = await orNotFound(getProject(auth, projectId));
  const report = await orNotFound(getRunReport(auth, projectId, runId));
  const archived = project.status === "ARCHIVED";
  const role = auth.user.role;
  return (
    <ReportWorkspace
      key={report.run.id}
      report={report}
      archived={archived}
      can={{
        rerun: can(role, "runs:start") && !archived,
        defect: can(role, "defects:write") && !archived,
        analyse: can(role, "ai:run") && !archived,
        exportFile: can(role, "exports:create"),
        share: can(role, "reports:share"),
      }}
    />
  );
}
