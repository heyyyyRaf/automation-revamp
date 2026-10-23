import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import { getDocumentProxy } from "unpdf";
import type { DocumentCategoryName } from "@/lib/validation";
import { AppError, payloadTooLarge, unsupportedMediaType } from "@/server/errors";
import { lowerExtension } from "@/server/uploads/filename";
import { vetDocx } from "@/server/uploads/zip-inspect";

export type FileKind = "pdf" | "docx" | "png" | "jpg" | "md" | "txt" | "csv";

const EXTENSIONS: Record<string, FileKind> = {
  ".pdf": "pdf",
  ".docx": "docx",
  ".png": "png",
  ".jpg": "jpg",
  ".jpeg": "jpg",
  ".md": "md",
  ".markdown": "md",
  ".txt": "txt",
  ".csv": "csv",
};

export const MIME_TYPES: Record<FileKind, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  png: "image/png",
  jpg: "image/jpeg",
  md: "text/markdown",
  txt: "text/plain",
  csv: "text/csv",
};

export function kindFromMime(mime: string): FileKind | undefined {
  return (Object.keys(MIME_TYPES) as FileKind[]).find((k) => MIME_TYPES[k] === mime);
}

/** Kinds whose text is extracted; images are kept as-is for AI vision in Phase 2. */
export const EXTRACTABLE_KINDS = new Set<FileKind>(["pdf", "docx", "md", "txt", "csv"]);

export const ALLOWED_KINDS: Record<DocumentCategoryName, readonly FileKind[]> = {
  REQUIREMENTS: ["pdf", "docx", "md", "txt", "csv"],
  SYSTEM_FLOW: ["png", "jpg", "pdf"],
  FIGMA: ["png", "jpg"],
};

/** What file-type must detect for each binary kind (the real file signature). */
const SIGNATURE: Partial<Record<FileKind, string>> = {
  pdf: "pdf",
  docx: "docx",
  png: "png",
  jpg: "jpg",
};

const TEXT_KINDS = new Set<FileKind>(["md", "txt", "csv"]);
const MAX_IMAGE_PIXELS = 60_000_000;
const MAX_PDF_PAGES = 1000;

export interface ValidatedUpload {
  kind: FileKind;
  mimeType: string;
  /** Bytes to store — images are re-encoded to strip metadata and hidden payloads. */
  bytes: Buffer;
}

export function allowedExtensionsLabel(category: DocumentCategoryName): string {
  return ALLOWED_KINDS[category].map((k) => k.toUpperCase()).join(", ");
}

/**
 * Validates an upload by its real content (magic bytes), not just its name.
 * Throws AppError with a plain-language message on rejection.
 */
export async function validateUpload(input: {
  bytes: Buffer;
  fileName: string;
  category: DocumentCategoryName;
  maxBytes: number;
}): Promise<ValidatedUpload> {
  const { bytes, fileName, category, maxBytes } = input;
  if (bytes.length === 0) throw unsupportedMediaType("This file is empty.");
  if (bytes.length > maxBytes) {
    throw payloadTooLarge(`This file is larger than ${Math.floor(maxBytes / 1024 / 1024)} MB.`);
  }

  const kind = EXTENSIONS[lowerExtension(fileName)];
  if (!kind || !ALLOWED_KINDS[category].includes(kind)) {
    throw unsupportedMediaType(
      `This file type isn't allowed here. Allowed: ${allowedExtensionsLabel(category)}.`,
    );
  }

  const detected = await fileTypeFromBuffer(bytes);
  if (TEXT_KINDS.has(kind)) {
    if (detected || !isUtf8Text(bytes)) {
      throw unsupportedMediaType(`This file isn't a plain-text .${kind} file.`);
    }
    return { kind, mimeType: MIME_TYPES[kind], bytes };
  }

  if (detected?.ext !== SIGNATURE[kind]) {
    throw unsupportedMediaType(
      `This file's content doesn't match its .${kind === "jpg" ? "jpg" : kind} extension.`,
    );
  }

  switch (kind) {
    case "docx": {
      const reason = vetDocx(bytes);
      if (reason) throw unsupportedMediaType(reason);
      return { kind, mimeType: MIME_TYPES.docx, bytes };
    }
    case "pdf":
      await vetPdf(bytes);
      return { kind, mimeType: MIME_TYPES.pdf, bytes };
    case "png":
    case "jpg":
      return { kind, mimeType: MIME_TYPES[kind], bytes: await reencodeImage(bytes, kind) };
    default:
      throw unsupportedMediaType("Unsupported file.");
  }
}

/** Valid UTF-8 with no NUL bytes (rejects binaries renamed to .txt). */
export function isUtf8Text(bytes: Buffer): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/** Rejects encrypted PDFs and PDFs with JavaScript, auto-actions or embedded files. */
async function vetPdf(bytes: Buffer): Promise<void> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    pdf = await getDocumentProxy(new Uint8Array(bytes), { disableFontFace: true });
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "PasswordException") {
      throw unsupportedMediaType(
        "This PDF is password-protected. Remove the password and try again.",
      );
    }
    throw unsupportedMediaType("This PDF couldn't be read. It may be damaged.");
  }
  try {
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw unsupportedMediaType(`This PDF has more than ${MAX_PDF_PAGES} pages.`);
    }
    const [js, attachments] = await Promise.all([pdf.getJSActions(), pdf.getAttachments()]);
    if (hasEntries(js)) {
      throw unsupportedMediaType(
        "This PDF contains scripts. Print or export it to a plain PDF and try again.",
      );
    }
    if (hasEntries(attachments)) {
      throw unsupportedMediaType("This PDF contains embedded files. Remove them and try again.");
    }
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      if (hasEntries(await page.getJSActions())) {
        throw unsupportedMediaType(
          "This PDF contains scripts. Print or export it to a plain PDF and try again.",
        );
      }
    }
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw unsupportedMediaType("This PDF couldn't be read. It may be damaged.");
  } finally {
    await pdf.cleanup();
  }
}

function hasEntries(value: unknown): boolean {
  if (value == null) return false;
  if (value instanceof Map) return value.size > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return false;
}

/** Decodes and re-encodes the image: drops EXIF/XMP/ICC text, appended data and polyglot payloads. */
async function reencodeImage(bytes: Buffer, kind: "png" | "jpg"): Promise<Buffer> {
  try {
    const img = sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: "error" }).rotate();
    return kind === "png"
      ? await img.png({ compressionLevel: 9 }).toBuffer()
      : await img.jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  } catch {
    throw unsupportedMediaType("This image couldn't be read, or it is too large.");
  }
}
