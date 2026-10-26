import type { Metadata } from "next";
import { can } from "@/lib/permissions";
import { requireAuthPage } from "@/server/auth/current-user";
import { db } from "@/server/db";
import { orNotFound } from "@/server/page-guard";
import { latestJobs } from "@/server/services/ai-jobs";
import { listEnvironments } from "@/server/services/environments";
import { getProject } from "@/server/services/projects";
import { listScenarios } from "@/server/services/scenarios";
import { listScripts } from "@/server/services/scripts";
import { ScriptsWorkspace } from "./scripts-workspace";

export const metadata: Metadata = { title: "Test scripts" };

/** Design: "Review test scripts" (FR-6). */
export default async function ScriptsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const auth = await requireAuthPage();
  const project = await orNotFound(getProject(auth, projectId));
  const [scripts, environments, scenarios, jobs, tagRows] = await Promise.all([
    listScripts(auth, projectId),
    listEnvironments(auth, projectId),
    listScenarios(auth, projectId),
    latestJobs(auth, projectId, ["GENERATE_SCRIPT", "FIX_SCRIPT"]),
    db.testCase.findMany({
      where: { projectId, deletedAt: null, script: { is: { approvedVersionId: { not: null } } } },
      select: { tags: true },
    }),
  ]);
  const archived = project.status === "ARCHIVED";
  const role = auth.user.role;
  const job = jobs.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0] ?? null;

  return (
    <ScriptsWorkspace
      projectId={projectId}
      projectName={project.name}
      archived={archived}
      initialScripts={scripts}
      initialJob={job}
      runTargets={{
        environments: environments.map((e) => ({
          id: e.id,
          name: e.name,
          verified: e.verified,
          shared: e.shared,
        })),
        scenarios: scenarios.map((s) => ({ id: s.id, key: s.key, title: s.title })),
        tags: [...new Set(tagRows.flatMap((t) => t.tags))].sort(),
      }}
      canWrite={can(role, "scripts:write") && !archived}
      canApprove={can(role, "scripts:approve") && !archived}
      canRun={can(role, "runs:start") && !archived}
    />
  );
}
