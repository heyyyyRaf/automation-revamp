import { json, route } from "@/server/http/handler";
import { getRun } from "@/server/services/runs";

type P = { projectId: string; runId: string };

export const GET = route<P>(async ({ auth, params }) =>
  json({ run: await getRun(auth, params.projectId, params.runId) }),
);
