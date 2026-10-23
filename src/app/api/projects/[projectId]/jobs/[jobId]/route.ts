import { isValidId, requireProjectAccess } from "@/server/authz/guards";
import { db } from "@/server/db";
import { notFound } from "@/server/errors";
import { json, route } from "@/server/http/handler";

export const GET = route<{ projectId: string; jobId: string }>(async ({ auth, params }) => {
  await requireProjectAccess(auth, params.projectId, "projects:read");
  if (!isValidId(params.jobId)) throw notFound("Job");
  const job = await db.job.findFirst({
    where: { id: params.jobId, projectId: params.projectId },
    select: {
      id: true,
      type: true,
      status: true,
      progress: true,
      attempts: true,
      maxAttempts: true,
      error: true,
      createdAt: true,
      startedAt: true,
      finishedAt: true,
    },
  });
  if (!job) throw notFound("Job");
  return json({ job });
});
