import { documentUpdateSchema } from "@/lib/validation";
import { json, readJson, route } from "@/server/http/handler";
import { deleteDocument, getDocument, updateDocumentTag } from "@/server/services/documents";

type P = { projectId: string; documentId: string };

export const GET = route<P>(async ({ auth, params }) =>
  json({ document: await getDocument(auth, params.projectId, params.documentId) }),
);

/** Change the file's type tag (FR-2.3). */
export const PATCH = route<P>(async ({ auth, req, params, ip, requestId }) => {
  const { typeTag } = await readJson(req, documentUpdateSchema);
  const document = await updateDocumentTag(auth, params.projectId, params.documentId, typeTag, {
    ip,
    requestId,
  });
  return json({ document });
});

export const DELETE = route<P>(async ({ auth, params, ip, requestId }) => {
  await deleteDocument(auth, params.projectId, params.documentId, { ip, requestId });
  return json({ ok: true });
});
