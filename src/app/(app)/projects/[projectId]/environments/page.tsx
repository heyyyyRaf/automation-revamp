import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon } from "@/components/icons";
import { FlowSteps } from "@/components/project/flow-steps";
import { PageHeader } from "@/components/project/page-header";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/permissions";
import { requireAuthPage } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-guard";
import { listEnvironments } from "@/server/services/environments";
import { getProjectOverview } from "@/server/services/projects";
import { listTargets } from "@/server/services/targets";
import { AddressesCard } from "./addresses-card";
import { EnvironmentsWorkspace } from "./environments-workspace";

export const metadata: Metadata = { title: "Environments" };

/** FRD step 5: where the tests run (FR-7). */
export default async function EnvironmentsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const auth = await requireAuthPage();
  const { project, step } = await orNotFound(getProjectOverview(auth, projectId));
  const [environments, targets] = await Promise.all([
    listEnvironments(auth, projectId),
    listTargets(auth, projectId),
  ]);
  const archived = project.status === "ARCHIVED";
  const role = auth.user.role;
  const anyVerified = environments.some((e) => e.verified);

  return (
    <>
      <PageHeader
        crumbs={[
          { label: "Projects", href: "/projects" },
          { label: project.name, href: `/projects/${projectId}` },
          { label: "Environments" },
        ]}
        title="Environments"
        archived={archived}
        subtitle="Where the tests run: the app's address, test accounts and settings. Runs are blocked until an environment passes its check."
        actions={
          <Button asChild variant={anyVerified ? "primary" : "secondary"}>
            <Link href={`/projects/${projectId}/scripts`}>
              Continue to scripts <ArrowRightIcon />
            </Link>
          </Button>
        }
      />
      <FlowSteps projectId={projectId} current={step} />
      <div className="flex flex-wrap items-start gap-6">
        <EnvironmentsWorkspace
          projectId={projectId}
          apiBase={`/api/projects/${projectId}/environments`}
          environments={environments}
          targets={targets}
          canManage={can(role, "environments:manage") && !archived}
          canManageShared={false}
        />
        <AddressesCard
          projectId={projectId}
          targets={targets}
          canRequest={can(role, "targets:request") && !archived}
          canApprove={can(role, "targets:approve") && !archived}
        />
      </div>
    </>
  );
}
