import type { Metadata } from "next";
import { can } from "@/lib/permissions";
import { requireAuthPage } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-guard";
import { getProject } from "@/server/services/projects";
import { getRun } from "@/server/services/runs";
import { LiveRun } from "./live-run";

export const metadata: Metadata = { title: "Live run" };

/** Design: "Run #12 · watching live" (FR-8.1 live status per case). */
export default async function RunPage({
  params,
}: {
  params: Promise<{ projectId: string; runId: string }>;
}) {
  const { projectId, runId } = await params;
  const auth = await requireAuthPage();
  const project = await orNotFound(getProject(auth, projectId));
  const run = await orNotFound(getRun(auth, projectId, runId));
  return (
    <LiveRun
      key={run.id}
      projectId={projectId}
      projectName={project.name}
      initialRun={run}
      canControl={can(auth.user.role, "runs:control") && project.status !== "ARCHIVED"}
    />
  );
}
