import { route } from "@/server/http/handler";
import { getDocumentFile } from "@/server/services/documents";

type P = { projectId: string; documentId: string };

/** Always served as a download, never rendered inline by the browser. */
export const GET = route<P>(async ({ auth, params }) => {
  const file = await getDocumentFile(auth, params.projectId, params.documentId);
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "content-type": file.mimeType,
      "content-length": String(file.bytes.length),
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox; default-src 'none'",
      "cache-control": "private, no-store",
    },
  });
});
