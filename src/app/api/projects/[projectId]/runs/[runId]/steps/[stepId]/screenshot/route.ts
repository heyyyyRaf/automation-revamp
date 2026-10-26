import { route } from "@/server/http/handler";
import { getStepScreenshot } from "@/server/services/runs";

type P = { projectId: string; runId: string; stepId: string };

/** The page after a step, shown inline in the Live run view (an image, never HTML). */
export const GET = route<P>(async ({ auth, params }) => {
  const shot = await getStepScreenshot(auth, params.projectId, params.runId, params.stepId);
  return new Response(new Uint8Array(shot.bytes), {
    headers: {
      "content-type": shot.mimeType,
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox; default-src 'none'",
      "cache-control": "private, max-age=3600",
    },
  });
});
