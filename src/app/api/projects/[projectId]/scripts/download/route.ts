import { downloadResponse } from "@/server/http/download";
import { route } from "@/server/http/handler";
import { downloadScripts } from "@/server/services/scripts";

/** Design "Download scripts (.zip)": approved scripts as a Playwright project. */
export const GET = route<{ projectId: string }>(async ({ auth, params, ip, requestId }) =>
  downloadResponse(await downloadScripts(auth, params.projectId, { ip, requestId })),
);
