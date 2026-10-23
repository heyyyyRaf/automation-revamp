import type { Metadata } from "next";
import { can } from "@/lib/permissions";
import { requireAuthPage } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-guard";
import { listExports } from "@/server/services/exports";
import { getProject } from "@/server/services/projects";
import { listRequirements } from "@/server/services/requirements";
import { listTestCases } from "@/server/services/test-cases";
import { ExportPanel } from "./export-panel";
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
  const [testCases, requirements, exports] = await Promise.all([
    listTestCases(auth, projectId),
    listRequirements(auth, projectId),
    listExports(auth, projectId),
  ]);
  const archived = project.status === "ARCHIVED";

  return (
    <div className="flex flex-col gap-6">
      <TestCasesWorkspace
        projectId={projectId}
        initialTestCases={testCases}
        requirements={requirements.map((r) => ({ id: r.id, key: r.key, text: r.text }))}
        canWrite={can(auth.user.role, "testcases:write") && !archived}
        canReview={can(auth.user.role, "testcases:review") && !archived}
      />
      <ExportPanel
        projectId={projectId}
        initialExports={exports}
        canExport={can(auth.user.role, "exports:create")}
      />
    </div>
  );
}
