import type { Metadata } from "next";
import { PageHeader } from "@/components/project/page-header";
import { can } from "@/lib/permissions";
import { requireAuthPage } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-guard";
import { listDefects } from "@/server/services/defects";
import { getProject } from "@/server/services/projects";
import { DefectsWorkspace } from "./defects-workspace";

export const metadata: Metadata = { title: "Defects" };

/** FRD step 7: defects logged from failed cases (manually in v1; Jira/ClickUp later). */
export default async function DefectsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const auth = await requireAuthPage();
  const project = await orNotFound(getProject(auth, projectId));
  const defects = await listDefects(auth, projectId);
  const archived = project.status === "ARCHIVED";
  return (
    <>
      <PageHeader
        crumbs={[
          { label: "Projects", href: "/projects" },
          { label: project.name, href: `/projects/${projectId}` },
          { label: "Runs", href: `/projects/${projectId}/runs` },
          { label: "Defects" },
        ]}
        title="Defects"
        archived={archived}
        subtitle="Problems found by runs. Log them from a run report, then track them here."
      />
      <DefectsWorkspace
        projectId={projectId}
        defects={defects}
        canWrite={can(auth.user.role, "defects:write") && !archived}
      />
    </>
  );
}
