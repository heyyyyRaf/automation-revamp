import type { Metadata } from "next";
import { FlowSteps } from "@/components/project/flow-steps";
import { PageHeader } from "@/components/project/page-header";
import { can } from "@/lib/permissions";
import { requireAuthPage } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-guard";
import { latestJobs } from "@/server/services/ai-jobs";
import { getProjectOverview } from "@/server/services/projects";
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
  const { project, step } = await orNotFound(getProjectOverview(auth, projectId));
  const [requirements, flows, questions, jobs] = await Promise.all([
    listRequirements(auth, projectId),
    listFlows(auth, projectId),
    listQuestions(auth, projectId),
    latestJobs(auth, projectId, ["GENERATE_TEST_CASES"]),
  ]);
  const archived = project.status === "ARCHIVED";

  return (
    <>
      <PageHeader
        crumbs={[
          { label: "Projects", href: "/projects" },
          { label: project.name, href: `/projects/${projectId}` },
          { label: "Requirements" },
        ]}
        title="Requirements"
        archived={archived}
        subtitle="Check what the assistant found. Edit, merge duplicates or add anything it missed — test cases are written from this list."
      />
      <FlowSteps projectId={projectId} current={step} />
      <RequirementsWorkspace
        projectId={projectId}
        initialRequirements={requirements}
        initialFlows={flows}
        initialQuestions={questions}
        initialGenerationJob={jobs[0] ?? null}
        canWrite={can(auth.user.role, "requirements:write") && !archived}
        canRunAi={can(auth.user.role, "ai:run") && !archived}
      />
    </>
  );
}
