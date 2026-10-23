import { documentCategorySchema, figmaLinkSchema } from "@/lib/validation";
import { badRequest } from "@/server/errors";
import { json, readJson, route } from "@/server/http/handler";
import { readLimitedFormData } from "@/server/http/multipart";
import {
  addFigmaLink,
  listDocuments,
  maxUploadBytes,
  uploadDocument,
} from "@/server/services/documents";

type P = { projectId: string };

/** Multipart overhead allowance on top of the file size limit. */
const FORM_OVERHEAD = 64 * 1024;

export const GET = route<P>(async ({ auth, params }) =>
  json({ documents: await listDocuments(auth, params.projectId) }),
);

/** multipart/form-data { category, file } uploads a file; JSON { url, name? } adds a Figma link. */
export const POST = route<P>(async ({ auth, req, params, ip, requestId }) => {
  const meta = { ip, requestId };
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.startsWith("application/json")) {
    const input = await readJson(req, figmaLinkSchema);
    return json({ document: await addFigmaLink(auth, params.projectId, input, meta) }, 201);
  }

  const form = await readLimitedFormData(req, maxUploadBytes() + FORM_OVERHEAD);
  const category = documentCategorySchema.safeParse(form.get("category"));
  if (!category.success) throw badRequest("Choose where this file belongs.");
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("Choose a file to upload.");

  const document = await uploadDocument(
    auth,
    params.projectId,
    { category: category.data, file },
    meta,
  );
  return json({ document }, 201);
});
