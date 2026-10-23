import { json, route } from "@/server/http/handler";
import { retryExtraction } from "@/server/services/documents";

export const POST = route<{ projectId: string; documentId: string }>(async ({ auth, params }) =>
  json({ document: await retryExtraction(auth, params.projectId, params.documentId) }),
);
