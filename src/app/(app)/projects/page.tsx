import type { Metadata } from "next";
import Link from "next/link";
import { FolderKanban, FileText, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { can } from "@/lib/permissions";
import { formatDate } from "@/lib/utils";
import { requireAuthPage } from "@/server/auth/current-user";
import { listProjects } from "@/server/services/projects";
import { CreateProjectDialog } from "./create-project-dialog";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const auth = await requireAuthPage();
  const showArchived = (await searchParams).archived === "1";
  const projects = await listProjects(auth, { includeArchived: showArchived });
  const canCreate = can(auth.user.role, "projects:create");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Projects</h1>
          <p className="mt-1 text-slate-600">
            Each project holds one app&apos;s requirements, test cases and test runs.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={showArchived ? "/projects" : "/projects?archived=1"}
            className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm text-slate-700 hover:bg-slate-100"
          >
            {showArchived ? "Hide archived" : "Show archived"}
          </Link>
          {canCreate && <CreateProjectDialog />}
        </div>
      </div>

      {projects.length === 0 ? (
        <EmptyState
          icon={<FolderKanban />}
          title="No projects yet"
          description={
            canCreate
              ? "Create your first project, then upload its requirements to get started."
              : "You haven't been added to any project yet. Ask your Admin / QA Lead to add you."
          }
          action={canCreate ? <CreateProjectDialog /> : undefined}
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <li key={p.id}>
              <Link
                href={`/projects/${p.id}`}
                className="focus-visible:ring-accent block h-full rounded-xl focus-visible:ring-2 focus-visible:outline-none"
              >
                <Card className="hover:border-accent/50 flex h-full flex-col gap-3 p-5 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="text-lg font-semibold">{p.name}</h2>
                    {p.status === "ARCHIVED" && <Badge>Archived</Badge>}
                  </div>
                  {p.description && (
                    <p className="line-clamp-2 text-sm text-slate-600">{p.description}</p>
                  )}
                  <div className="mt-auto flex items-center gap-4 text-sm text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      <FileText className="size-4" aria-hidden /> {p.documentCount} files
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Users className="size-4" aria-hidden /> {p.memberCount} members
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">Updated {formatDate(p.updatedAt)}</p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
