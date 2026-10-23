import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ChevronLeft } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { can } from "@/lib/permissions";
import { requireAuthPage } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-guard";
import { listDocuments } from "@/server/services/documents";
import { listMembers } from "@/server/services/members";
import { getProject } from "@/server/services/projects";
import { listUsers } from "@/server/services/users";
import { DocumentsWorkspace } from "./documents-workspace";
import { MembersPanel } from "./members-panel";
import { ProjectActions } from "./project-actions";

export const metadata: Metadata = { title: "Upload & analysis" };

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const auth = await requireAuthPage();
  const project = await orNotFound(getProject(auth, projectId));
  const [documents, members] = await Promise.all([
    listDocuments(auth, projectId),
    listMembers(auth, projectId),
  ]);
  const isAdmin = can(auth.user.role, "projects:manage-members");
  const allUsers = isAdmin ? await listUsers() : [];
  const archived = project.status === "ARCHIVED";
  const canWrite = can(auth.user.role, "documents:write") && !archived;
  const readyCount = documents.filter((d) => d.extractionStatus === "SUCCEEDED").length;

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
          You can still read everything, but nothing can be changed until an Admin restores it.
        </Alert>
      )}

      <section aria-labelledby="step-upload" className="flex flex-col gap-3">
        <div>
          <h2 id="step-upload" className="text-xl font-semibold">
            Step 1 · Upload project documents
          </h2>
          <p className="text-slate-600">
            Add everything that describes how the app should work. We read the text automatically.
          </p>
        </div>
        <DocumentsWorkspace
          projectId={project.id}
          initialDocuments={documents}
          canWrite={canWrite}
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Next step · Analyze requirements</CardTitle>
          <CardDescription>
            AI will pull out each requirement, user flow and open question from your documents.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Button size="lg" disabled>
            Analyze requirements <ArrowRight aria-hidden />
          </Button>
          <p className="text-sm text-slate-500">
            {readyCount === 0
              ? "Upload at least one requirements document first."
              : "AI analysis arrives in Phase 2."}
          </p>
        </CardContent>
      </Card>

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
