import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/project/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { can } from "@/lib/permissions";
import { requireAuthPage } from "@/server/auth/current-user";
import { canManageProject } from "@/server/authz/guards";
import { orNotFound } from "@/server/page-guard";
import { aiBudget } from "@/server/services/ai-jobs";
import { listMembers } from "@/server/services/members";
import { getProject } from "@/server/services/projects";
import { listUsers } from "@/server/services/users";
import { AiBudgetCard } from "./ai-budget-card";
import { MembersPanel } from "./members-panel";
import { ProjectActions } from "./project-actions";
import { ProjectDetailsForm } from "./project-details-form";

export const metadata: Metadata = { title: "Project settings" };

/** Owner / Admin only: details, owner, members, AI limit, archive. */
export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const auth = await requireAuthPage();
  const project = await orNotFound(getProject(auth, projectId));
  if (!canManageProject(auth, project)) notFound();

  const [members, budget, users] = await Promise.all([
    listMembers(auth, projectId),
    aiBudget(auth, projectId),
    listUsers(),
  ]);
  const archived = project.status === "ARCHIVED";
  const owners = members
    .filter((m) => m.user.isActive && m.user.role !== "VIEWER")
    .map((m) => ({ id: m.user.id, name: m.user.name }));

  return (
    <>
      <PageHeader
        crumbs={[
          { label: "Projects", href: "/projects" },
          { label: project.name, href: `/projects/${projectId}` },
          { label: "Settings" },
        ]}
        title="Project settings"
        archived={archived}
      />
      <div className="grid max-w-4xl gap-6">
        <ProjectDetailsForm
          projectId={projectId}
          name={project.name}
          description={project.description}
          ownerId={project.ownerId}
          owners={owners}
          disabled={archived}
        />
        <MembersPanel
          projectId={projectId}
          ownerId={project.ownerId}
          members={members}
          canManage={!archived}
          users={users
            .filter((u) => u.isActive)
            .map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role }))}
        />
        <AiBudgetCard
          projectId={projectId}
          initialBudget={budget}
          canEdit={can(auth.user.role, "settings:manage")}
        />
        <Card>
          <CardHeader>
            <CardTitle>{archived ? "Restore project" : "Archive project"}</CardTitle>
            <CardDescription>
              {archived
                ? "Make the project editable again."
                : "An archived project is read-only and hidden from the project list. You can restore it later."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProjectActions projectId={projectId} archived={archived} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
