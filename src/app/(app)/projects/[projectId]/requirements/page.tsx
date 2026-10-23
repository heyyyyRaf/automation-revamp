import type { Metadata } from "next";
import { can } from "@/lib/permissions";
import { requireAuthPage } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-guard";
import { latestJobs } from "@/server/services/ai-jobs";
import { getProject } from "@/server/services/projects";
import { listFlows, listQuestions, listRequirements } from "@/server/services/requirements";
import { RequirementsWorkspace } from "./requirements-workspace";

export const metadata: Metadata = { title: "Requirements" };

export default async function RequirementsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const auth = await requireAuthPage();
  const project = await orNotFound(getProject(auth, projectId));
  const [requirements, flows, questions, jobs] = await Promise.all([
    listRequirements(auth, projectId),
    listFlows(auth, projectId),
    listQuestions(auth, projectId),
    latestJobs(auth, projectId, ["GENERATE_TEST_CASES"]),
  ]);
  const archived = project.status === "ARCHIVED";

  return (
    <RequirementsWorkspace
      projectId={projectId}
      initialRequirements={requirements}
      initialFlows={flows}
      initialQuestions={questions}
      initialGenerationJob={jobs[0] ?? null}
      canWrite={can(auth.user.role, "requirements:write") && !archived}
      canRunAi={can(auth.user.role, "ai:run") && !archived}
    />
  );
}
