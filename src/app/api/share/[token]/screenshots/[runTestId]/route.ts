import { route } from "@/server/http/handler";
import { getSharedScreenshot } from "@/server/services/shares";

type P = { token: string; runTestId: string };

/** Public: a failure screenshot of the run behind a valid, unexpired share link. */
export const GET = route<P>({ auth: false }, async ({ params, ip }) => {
  const shot = await getSharedScreenshot(params.token, params.runTestId, ip);
  return new Response(new Uint8Array(shot.bytes), {
    headers: {
      "content-type": shot.mimeType,
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox; default-src 'none'",
      "cache-control": "private, no-store",
      "referrer-policy": "no-referrer",
      "x-robots-tag": "noindex, nofollow",
    },
  });
});
