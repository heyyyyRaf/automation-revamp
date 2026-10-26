import type { Metadata } from "next";
import { FlowSteps } from "@/components/project/flow-steps";
import { PageHeader } from "@/components/project/page-header";
import { can } from "@/lib/permissions";
import { requireAuthPage } from "@/server/auth/current-user";
import { db } from "@/server/db";
import { orNotFound } from "@/server/page-guard";
import { listEnvironments } from "@/server/services/environments";
import { getProjectOverview } from "@/server/services/projects";
import { listRuns } from "@/server/services/runs";
import { listScenarios } from "@/server/services/scenarios";
import { RunsList } from "./runs-list";

export const metadata: Metadata = { title: "Runs" };

/** FRD step 6: run approved scripts and watch them (FR-8). */
export default async function RunsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const auth = await requireAuthPage();
  const { project, step } = await orNotFound(getProjectOverview(auth, projectId));
  const [runs, environments, scenarios, tagRows] = await Promise.all([
    listRuns(auth, projectId),
    listEnvironments(auth, projectId),
    listScenarios(auth, projectId),
    db.testCase.findMany({
      where: { projectId, deletedAt: null, script: { is: { approvedVersionId: { not: null } } } },
      select: { tags: true },
    }),
  ]);
  const archived = project.status === "ARCHIVED";

  return (
    <>
      <PageHeader
        crumbs={[
          { label: "Projects", href: "/projects" },
          { label: project.name, href: `/projects/${projectId}` },
          { label: "Runs" },
        ]}
        title="Runs and reports"
        archived={archived}
        subtitle="Approved scripts run in isolated browsers, up to five at a time. Watch any run live."
      />
      <FlowSteps projectId={projectId} current={step} />
      <RunsList
        projectId={projectId}
        runs={runs}
        targets={{
          environments: environments.map((e) => ({
            id: e.id,
            name: e.name,
            verified: e.verified,
            shared: e.shared,
          })),
          scenarios: scenarios.map((s) => ({ id: s.id, key: s.key, title: s.title })),
          tags: [...new Set(tagRows.flatMap((t) => t.tags))].sort(),
        }}
        canRun={can(auth.user.role, "runs:start") && !archived}
      />
    </>
  );
}
