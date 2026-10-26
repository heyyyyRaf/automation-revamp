import type { Metadata } from "next";
import { can } from "@/lib/permissions";
import { requireAuthPage } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-guard";
import { getProject } from "@/server/services/projects";
import { listRequirements } from "@/server/services/requirements";
import { listScenarios } from "@/server/services/scenarios";
import { listTestCases } from "@/server/services/test-cases";
import { TestCasesWorkspace } from "./test-cases-workspace";

export const metadata: Metadata = { title: "Review test cases" };

export default async function TestCasesPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const auth = await requireAuthPage();
  const project = await orNotFound(getProject(auth, projectId));
  const [testCases, requirements, scenarios] = await Promise.all([
    listTestCases(auth, projectId),
    listRequirements(auth, projectId),
    listScenarios(auth, projectId),
  ]);
  const archived = project.status === "ARCHIVED";
  const role = auth.user.role;

  return (
    <TestCasesWorkspace
      projectId={projectId}
      projectName={project.name}
      archived={archived}
      requirementCount={requirements.length}
      initialTestCases={testCases}
      scenarios={scenarios}
      requirements={requirements.map((r) => ({ id: r.id, key: r.key, text: r.text }))}
      canWrite={can(role, "testcases:write") && !archived}
      canReview={can(role, "testcases:review") && !archived}
      canRunAi={can(role, "ai:run") && !archived}
      canComment={can(role, "comments:create")}
      canExport={can(role, "exports:create")}
    />
  );
}
