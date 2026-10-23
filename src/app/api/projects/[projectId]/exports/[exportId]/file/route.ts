import { route } from "@/server/http/handler";
import { getExportFile } from "@/server/services/exports";

type P = { projectId: string; exportId: string };

export const GET = route<P>(async ({ auth, params, ip, requestId }) => {
  const file = await getExportFile(auth, params.projectId, params.exportId, { ip, requestId });
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "content-type": file.mimeType,
      "content-length": String(file.bytes.length),
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox; default-src 'none'",
      "cache-control": "private, no-store",
    },
  });
});
