import type { Metadata } from "next";
import { can } from "@/lib/permissions";
import { requireAuthPage } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-guard";
import { aiBudget, latestJobs } from "@/server/services/ai-jobs";
import { listDocuments } from "@/server/services/documents";
import { listMembers } from "@/server/services/members";
import { getProject } from "@/server/services/projects";
import { listUsers } from "@/server/services/users";
import { AnalysisPanel } from "./analysis-panel";
import { DocumentsWorkspace } from "./documents-workspace";
import { MembersPanel } from "./members-panel";

export const metadata: Metadata = { title: "Upload & analysis" };

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const auth = await requireAuthPage();
  const project = await orNotFound(getProject(auth, projectId));
  const [documents, members, jobs, budget] = await Promise.all([
    listDocuments(auth, projectId),
    listMembers(auth, projectId),
    latestJobs(auth, projectId, ["ANALYZE_REQUIREMENTS"]),
    aiBudget(auth, projectId),
  ]);
  const isAdmin = can(auth.user.role, "projects:manage-members");
  const allUsers = isAdmin ? await listUsers() : [];
  const archived = project.status === "ARCHIVED";
  const canWrite = can(auth.user.role, "documents:write") && !archived;
  const hasInput = documents.some(
    (d) =>
      d.extractionStatus === "SUCCEEDED" ||
      (d.source === "FILE" && (d.mimeType === "image/png" || d.mimeType === "image/jpeg")),
  );

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="step-upload" className="flex flex-col gap-3">
        <div>
          <h2 id="step-upload" className="text-xl font-semibold">
            Step 1 · Upload project documents
          </h2>
          <p className="text-slate-600">
            Add everything that describes how the app should work. We read the text automatically,
            and import frames from Figma links.
          </p>
        </div>
        <DocumentsWorkspace
          projectId={project.id}
          initialDocuments={documents}
          canWrite={canWrite}
        />
      </section>

      <AnalysisPanel
        projectId={project.id}
        initialJob={jobs[0] ?? null}
        initialBudget={budget}
        canRun={can(auth.user.role, "ai:run") && !archived}
        canEditBudget={can(auth.user.role, "projects:edit")}
        hasInput={hasInput}
      />

      <MembersPanel
        projectId={project.id}
        members={members}
        canManage={isAdmin && !archived}
        users={allUsers
          .filter((u) => u.isActive)
          .map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role }))}
      />
    </div>
  );
}
