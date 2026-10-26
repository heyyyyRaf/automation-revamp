import { downloadResponse } from "@/server/http/download";
import { route } from "@/server/http/handler";
import { getExportFile } from "@/server/services/exports";

type P = { projectId: string; exportId: string };

export const GET = route<P>(async ({ auth, params, ip, requestId }) =>
  downloadResponse(await getExportFile(auth, params.projectId, params.exportId, { ip, requestId })),
);
