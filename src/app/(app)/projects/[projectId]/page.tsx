import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon, SettingsIcon } from "@/components/icons";
import { FlowSteps } from "@/components/project/flow-steps";
import { PageHeader } from "@/components/project/page-header";
import { Button } from "@/components/ui/button";
import { canManageProject } from "@/server/authz/guards";
import { can } from "@/lib/permissions";
import { requireAuthPage } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-guard";
import { aiBudget, latestJobs } from "@/server/services/ai-jobs";
import { listDocuments } from "@/server/services/documents";
import { getProjectOverview } from "@/server/services/projects";
import { listFlows, listQuestions } from "@/server/services/requirements";
import { AssistantPanel } from "./assistant-panel";
import { ProjectFiles } from "./project-files";

export const metadata: Metadata = { title: "Upload and analysis" };

/** Design: "Upload and analysis" — the project's home screen. */
export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const auth = await requireAuthPage();
  const { project, owner, step, counts } = await orNotFound(getProjectOverview(auth, projectId));
  const [documents, jobs, budget, flows, questions] = await Promise.all([
    listDocuments(auth, projectId),
    latestJobs(auth, projectId, ["ANALYZE_REQUIREMENTS"]),
    aiBudget(auth, projectId),
    listFlows(auth, projectId),
    listQuestions(auth, projectId),
  ]);
  const archived = project.status === "ARCHIVED";
  const role = auth.user.role;
  const openQuestions = questions.filter((q) => q.status === "OPEN");

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Projects", href: "/projects" }, { label: project.name }]}
        title={project.name}
        archived={archived}
        subtitle={[project.description, `Owner: ${owner.name}`].filter(Boolean).join(" · ")}
        actions={
          <>
            {canManageProject(auth, project) && (
              <Button variant="secondary" asChild>
                <Link href={`/projects/${projectId}/settings`}>
                  <SettingsIcon /> Project settings
                </Link>
              </Button>
            )}
            <Button asChild>
              <Link
                href={
                  counts.cases > 0
                    ? `/projects/${projectId}/test-cases`
                    : `/projects/${projectId}/requirements`
                }
              >
                {counts.cases > 0 ? "Continue to test cases" : "Continue to requirements"}
                <ArrowRightIcon />
              </Link>
            </Button>
          </>
        }
      />
      <FlowSteps projectId={projectId} current={step} />
      <div className="flex flex-wrap items-start gap-6">
        <ProjectFiles
          projectId={projectId}
          initialDocuments={documents}
          canWrite={can(role, "documents:write") && !archived}
        />
        <AssistantPanel
          projectId={projectId}
          initialJob={jobs[0] ?? null}
          budget={budget}
          counts={{
            requirements: counts.reqs,
            flows: flows.length,
            questions: openQuestions.length,
          }}
          openQuestions={openQuestions}
          canRun={can(role, "ai:run") && !archived}
          canWrite={can(role, "requirements:write") && !archived}
          canExport={can(role, "exports:create")}
          hasInput={documents.some(
            (d) =>
              d.extractionStatus === "SUCCEEDED" ||
              (d.source === "FILE" && d.extractionStatus !== "NOT_APPLICABLE"),
          )}
          filesReading={
            documents.filter(
              (d) => d.extractionStatus === "PENDING" || d.extractionStatus === "PROCESSING",
            ).length
          }
        />
      </div>
    </>
  );
}
