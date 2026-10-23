import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { can } from "@/lib/permissions";
import { requireAuthPage } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-guard";
import { getProject } from "@/server/services/projects";
import { ProjectActions } from "./project-actions";
import { ProjectTabs } from "./project-tabs";

export default async function ProjectLayout({
  params,
  children,
}: {
  params: Promise<{ projectId: string }>;
  children: React.ReactNode;
}) {
  const { projectId } = await params;
  const auth = await requireAuthPage();
  const project = await orNotFound(getProject(auth, projectId));
  const archived = project.status === "ARCHIVED";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/projects"
          className="inline-flex min-h-11 items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
        >
          <ChevronLeft className="size-4" aria-hidden /> All projects
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold">{project.name}</h1>
              {archived && <Badge>Archived</Badge>}
            </div>
            {project.description && (
              <p className="mt-1 max-w-2xl text-slate-600">{project.description}</p>
            )}
          </div>
          {can(auth.user.role, "projects:archive") && (
            <ProjectActions projectId={project.id} archived={archived} />
          )}
        </div>
      </div>
      {archived && (
        <Alert tone="info" title="This project is archived">
          You can still read and export everything, but nothing can be changed until an Admin
          restores it.
        </Alert>
      )}
      <ProjectTabs projectId={project.id} />
      {children}
    </div>
  );
}
