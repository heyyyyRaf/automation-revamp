import { redirect } from "next/navigation";
import { requireAuthPage } from "@/server/auth/current-user";
import { db } from "@/server/db";
import { orNotFound } from "@/server/page-guard";
import { FINAL_RUN } from "@/server/runs/finish";
import { getProject } from "@/server/services/projects";

/** Flow step 8 "Report": the latest finished run's report, or the runs list if none yet. */
export default async function LatestReportPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const auth = await requireAuthPage();
  await orNotFound(getProject(auth, projectId));
  const latest = await db.run.findFirst({
    where: { projectId, status: { in: FINAL_RUN } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  redirect(
    latest ? `/projects/${projectId}/runs/${latest.id}/report` : `/projects/${projectId}/runs`,
  );
}
