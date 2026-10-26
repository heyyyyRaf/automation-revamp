import { isValidId, requireProjectAccess } from "@/server/authz/guards";
import { db } from "@/server/db";
import { notFound } from "@/server/errors";
import { json, route } from "@/server/http/handler";
import { JOB_PUBLIC_SELECT } from "@/server/services/ai-jobs";

/** One job's progress and result (counts, progress notes, rewrite proposals — never secrets). */
export const GET = route<{ projectId: string; jobId: string }>(async ({ auth, params }) => {
  await requireProjectAccess(auth, params.projectId, "projects:read");
  if (!isValidId(params.jobId)) throw notFound("Job");
  const job = await db.job.findFirst({
    where: { id: params.jobId, projectId: params.projectId },
    select: JOB_PUBLIC_SELECT,
  });
  if (!job) throw notFound("Job");
  return json({ job });
});
