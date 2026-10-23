import { json, route } from "@/server/http/handler";
import { deleteDocument, getDocument } from "@/server/services/documents";

type P = { projectId: string; documentId: string };

export const GET = route<P>(async ({ auth, params }) =>
  json({ document: await getDocument(auth, params.projectId, params.documentId) }),
);

export const DELETE = route<P>(async ({ auth, params, ip, requestId }) => {
  await deleteDocument(auth, params.projectId, params.documentId, { ip, requestId });
  return json({ ok: true });
});
