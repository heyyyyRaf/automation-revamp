import { notFound } from "@/server/errors";
import { downloadResponse } from "@/server/http/download";
import { route } from "@/server/http/handler";
import { getRunArtifact, type ArtifactKind } from "@/server/services/runs";

type P = { projectId: string; runId: string; runTestId: string; kind: string };

const KINDS = new Set<ArtifactKind>(["trace", "screenshot", "log", "console", "network"]);

/** FR-8.3: trace, failure screenshot, runner log, browser console and network log. */
export const GET = route<P>(async ({ auth, params }) => {
  if (!KINDS.has(params.kind as ArtifactKind)) throw notFound("File");
  const file = await getRunArtifact(
    auth,
    params.projectId,
    params.runId,
    params.runTestId,
    params.kind as ArtifactKind,
  );
  return downloadResponse(file);
});
