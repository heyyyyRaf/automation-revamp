import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { firstName } from "@/lib/format";
import { can } from "@/lib/permissions";
import { requireAuthPage } from "@/server/auth/current-user";
import { dashboardStats, listProjects } from "@/server/services/projects";
import { listUsers } from "@/server/services/users";
import { LAST_PROJECT_COOKIE } from "@/lib/nav";
import { CreateProjectDialog } from "./create-project-dialog";
import { ProjectsDashboard } from "./projects-dashboard";

export const metadata: Metadata = { title: "Projects" };

const PICK_LABEL: Record<string, string> = {
  "test-cases": "test cases",
  scripts: "test scripts",
  runs: "runs and reports",
};

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string; pick?: string }>;
}) {
  const auth = await requireAuthPage();
  const { archived, pick } = await searchParams;
  const showArchived = archived === "1";
  const projects = await listProjects(auth, { includeArchived: showArchived });

  // Sidebar "Test cases / Test scripts / Runs and reports" outside a project: open that module
  // in the last project you used (if you still have access), or in your only project.
  if (pick && PICK_LABEL[pick]) {
    const last = (await cookies()).get(LAST_PROJECT_COOKIE)?.value;
    const target =
      projects.find((p) => p.id === last) ?? (projects.length === 1 ? projects[0] : undefined);
    if (target) redirect(`/projects/${target.id}/${pick}`);
  }
  const stats = await dashboardStats(auth, projects);
  const canCreate = can(auth.user.role, "projects:create");
  const isAdmin = auth.user.role === "ADMIN";
  const owners = isAdmin
    ? (await listUsers())
        .filter((u) => u.isActive && u.role !== "VIEWER")
        .map((u) => ({ id: u.id, name: u.name }))
    : [];

  const tiles = [
    {
      label: "Active projects",
      value: String(stats.activeProjects),
      note: `${stats.addedThisWeek} added this week`,
    },
    {
      label: "Tests run this week",
      value: stats.testsRunThisWeek.toLocaleString(),
      note: `across ${stats.projectsRunThisWeek} project${stats.projectsRunThisWeek === 1 ? "" : "s"}`,
    },
    {
      label: "Average pass rate",
      value: stats.averagePassRate === null ? "—" : `${stats.averagePassRate}%`,
      note: "last run per project",
    },
    {
      label: "Waiting for your review",
      value: stats.awaitingReview.toLocaleString(),
      note: "test cases in Draft",
    },
  ];

  return (
    <ProjectsDashboard
      title={`Welcome back, ${firstName(auth.user.name)}`}
      subtitle="Here is how every project is doing today."
      canCreate={canCreate}
      actions={
        <>
          <Link
            href={showArchived ? "/projects" : "/projects?archived=1"}
            className="text-sm font-semibold"
          >
            {showArchived ? "Hide archived" : "Show archived"}
          </Link>
          {canCreate && <CreateProjectDialog owners={owners} currentUserId={auth.user.id} />}
        </>
      }
      notice={
        pick && PICK_LABEL[pick] ? (
          <Alert tone="info">Choose a project to open its {PICK_LABEL[pick]}.</Alert>
        ) : undefined
      }
      tiles={
        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
          {tiles.map((t) => (
            <Card key={t.label} className="flex flex-col gap-1.5 p-5">
              <div className="text-muted text-[13px] font-medium">{t.label}</div>
              <div className="text-[30px] font-bold">{t.value}</div>
              <div className="text-muted text-[13px]">{t.note}</div>
            </Card>
          ))}
        </div>
      }
      aside={
        <Card className="flex flex-[1_1_300px] flex-col gap-[18px] p-6">
          <h2 className="text-[17px] font-bold">New here? Three steps</h2>
          {[
            ["Upload the requirements", "FRD, user stories, Figma screenshots or flow diagrams."],
            [
              "Review the drafted test cases",
              "Edit, approve or reject. Nothing runs without your OK.",
            ],
            ["Add the app URL and run", "Get a report with screenshots of every failure."],
          ].map(([title, text], i) => (
            <div key={title} className="flex gap-3.5">
              <div className="bg-accent-soft text-accent-strong flex size-8 shrink-0 items-center justify-center rounded-full font-bold">
                {i + 1}
              </div>
              <div className="flex flex-col gap-1">
                <div className="font-semibold">{title}</div>
                <div className="text-muted text-[13px] leading-normal">{text}</div>
              </div>
            </div>
          ))}
          {canCreate && (
            <CreateProjectDialog owners={owners} currentUserId={auth.user.id} trigger="outline" />
          )}
        </Card>
      }
      projects={projects.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        ownerName: p.owner.name,
        stage: p.stage,
        lastPassRate: p.lastPassRate,
        testCaseCount: p.testCaseCount,
        draftCount: p.draftCount,
        activity: { kind: p.activity.kind, at: p.activity.at.toISOString() },
      }))}
    />
  );
}
