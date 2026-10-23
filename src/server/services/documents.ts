import { createHash } from "node:crypto";
import type { Document, DocumentCategory, Prisma } from "@/generated/prisma/client";
import type { DocumentCategoryName } from "@/lib/validation";
import type { AuthContext } from "@/server/auth/session";
import { isValidId, requireProjectAccess } from "@/server/authz/guards";
import { db } from "@/server/db";
import { getEnv } from "@/server/env";
import { badRequest, conflict, notFound, payloadTooLarge } from "@/server/errors";
import { enqueueJob } from "@/server/jobs/enqueue";
import { logger } from "@/server/logger";
import { audit } from "@/server/services/audit";
import { getStorage, newObjectKey } from "@/server/storage/storage";
import { sanitizeDisplayName } from "@/server/uploads/filename";
import { EXTRACTABLE_KINDS, validateUpload } from "@/server/uploads/validate";

interface Meta {
  ip: string;
  requestId: string;
}

/** Columns returned in lists (no extracted text, no storage key). */
export const DOCUMENT_LIST_SELECT = {
  id: true,
  category: true,
  source: true,
  originalName: true,
  mimeType: true,
  sizeBytes: true,
  linkUrl: true,
  extractionStatus: true,
  extractionError: true,
  pageCount: true,
  ocrUsed: true,
  createdAt: true,
  uploadedBy: { select: { id: true, name: true } },
} satisfies Prisma.DocumentSelect;

export type DocumentListItem = Prisma.DocumentGetPayload<{ select: typeof DOCUMENT_LIST_SELECT }>;

export function maxUploadBytes(): number {
  return getEnv().MAX_UPLOAD_MB * 1024 * 1024;
}

export async function uploadDocument(
  auth: AuthContext,
  projectId: string,
  input: { category: DocumentCategoryName; file: File },
  meta: Meta,
): Promise<DocumentListItem> {
  await requireProjectAccess(auth, projectId, "documents:write");
  const maxBytes = maxUploadBytes();
  if (input.file.size > maxBytes) {
    throw payloadTooLarge(`This file is larger than ${getEnv().MAX_UPLOAD_MB} MB.`);
  }

  const originalName = sanitizeDisplayName(input.file.name);
  const raw = Buffer.from(await input.file.arrayBuffer());
  const file = await validateUpload({
    bytes: raw,
    fileName: originalName,
    category: input.category,
    maxBytes,
  });

  const storageKey = newObjectKey(projectId, "documents");
  const sha256 = createHash("sha256").update(file.bytes).digest("hex");
  await getStorage().put(storageKey, file.bytes, file.mimeType);

  const extractable = EXTRACTABLE_KINDS.has(file.kind);
  let doc: Document;
  try {
    doc = await db.$transaction(async (tx) => {
      const created = await tx.document.create({
        data: {
          projectId,
          category: input.category as DocumentCategory,
          source: "FILE",
          originalName,
          mimeType: file.mimeType,
          sizeBytes: file.bytes.length,
          storageKey,
          sha256,
          extractionStatus: extractable ? "PENDING" : "NOT_APPLICABLE",
          uploadedById: auth.user.id,
        },
      });
      await audit(
        {
          action: "document.upload",
          entityType: "document",
          entityId: created.id,
          projectId,
          actorId: auth.user.id,
          metadata: { name: originalName, category: input.category, size: file.bytes.length },
          ipAddress: meta.ip,
          requestId: meta.requestId,
        },
        tx,
      );
      return created;
    });
  } catch (err) {
    // Don't leave an orphaned object behind if the DB write failed.
    await getStorage()
      .delete(storageKey)
      .catch((e: unknown) => logger.warn({ err: e }, "orphan cleanup failed"));
    throw err;
  }

  if (extractable) {
    await enqueueJob({
      projectId,
      type: "EXTRACT_TEXT",
      payload: { documentId: doc.id },
      createdById: auth.user.id,
    });
  }
  return getListItem(projectId, doc.id);
}

export async function addFigmaLink(
  auth: AuthContext,
  projectId: string,
  input: { url: string; name?: string | undefined },
  meta: Meta,
): Promise<DocumentListItem> {
  await requireProjectAccess(auth, projectId, "documents:write");
  const doc = await db.$transaction(async (tx) => {
    const created = await tx.document.create({
      data: {
        projectId,
        category: "FIGMA",
        source: "LINK",
        originalName: sanitizeDisplayName(input.name || "Figma design"),
        linkUrl: input.url,
        extractionStatus: "NOT_APPLICABLE",
        uploadedById: auth.user.id,
      },
    });
    await audit(
      {
        action: "document.upload",
        entityType: "document",
        entityId: created.id,
        projectId,
        actorId: auth.user.id,
        metadata: { category: "FIGMA", link: true },
        ipAddress: meta.ip,
        requestId: meta.requestId,
      },
      tx,
    );
    return created;
  });
  return getListItem(projectId, doc.id);
}

export async function listDocuments(
  auth: AuthContext,
  projectId: string,
): Promise<DocumentListItem[]> {
  await requireProjectAccess(auth, projectId, "documents:read");
  return db.document.findMany({
    where: { projectId, deletedAt: null },
    select: DOCUMENT_LIST_SELECT,
    orderBy: { createdAt: "desc" },
  });
}

export async function getDocument(auth: AuthContext, projectId: string, documentId: string) {
  await requireProjectAccess(auth, projectId, "documents:read");
  const doc = await findDoc(projectId, documentId);
  const item = await getListItem(projectId, doc.id);
  return { ...item, extractedText: doc.extractedText };
}

export async function getDocumentFile(auth: AuthContext, projectId: string, documentId: string) {
  await requireProjectAccess(auth, projectId, "documents:read");
  const doc = await findDoc(projectId, documentId);
  if (!doc.storageKey || !doc.mimeType) throw badRequest("This item is a link, not a file.");
  const bytes = await getStorage().get(doc.storageKey);
  return { bytes, mimeType: doc.mimeType, name: doc.originalName };
}

export async function deleteDocument(
  auth: AuthContext,
  projectId: string,
  documentId: string,
  meta: Meta,
): Promise<void> {
  await requireProjectAccess(auth, projectId, "documents:write");
  const doc = await findDoc(projectId, documentId);
  await db.$transaction(async (tx) => {
    await tx.document.update({ where: { id: doc.id }, data: { deletedAt: new Date() } });
    await audit(
      {
        action: "document.delete",
        entityType: "document",
        entityId: doc.id,
        projectId,
        actorId: auth.user.id,
        metadata: { name: doc.originalName },
        ipAddress: meta.ip,
        requestId: meta.requestId,
      },
      tx,
    );
  });
}

export async function retryExtraction(
  auth: AuthContext,
  projectId: string,
  documentId: string,
): Promise<DocumentListItem> {
  await requireProjectAccess(auth, projectId, "documents:write");
  const doc = await findDoc(projectId, documentId);
  if (doc.extractionStatus !== "FAILED") {
    throw conflict("Text extraction can only be retried after it has failed.");
  }
  await db.document.update({
    where: { id: doc.id },
    data: { extractionStatus: "PENDING", extractionError: null },
  });
  await enqueueJob({
    projectId,
    type: "EXTRACT_TEXT",
    payload: { documentId: doc.id },
    createdById: auth.user.id,
  });
  return getListItem(projectId, doc.id);
}

async function findDoc(projectId: string, documentId: string): Promise<Document> {
  if (!isValidId(documentId)) throw notFound("Document");
  // projectId in the WHERE clause: a document ID from another project is simply not found.
  const doc = await db.document.findFirst({
    where: { id: documentId, projectId, deletedAt: null },
  });
  if (!doc) throw notFound("Document");
  return doc;
}

async function getListItem(projectId: string, id: string): Promise<DocumentListItem> {
  const item = await db.document.findFirst({
    where: { id, projectId },
    select: DOCUMENT_LIST_SELECT,
  });
  if (!item) throw notFound("Document");
  return item;
}
