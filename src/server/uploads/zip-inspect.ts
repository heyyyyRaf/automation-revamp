/**
 * Minimal ZIP central-directory reader (no decompression). Used to vet DOCX files
 * *before* any library unzips them: rejects zip bombs, macros, and ZIP64 archives.
 */
export interface ZipEntry {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
}

const EOCD_SIG = 0x06054b50;
const CDH_SIG = 0x02014b50;
const MAX_COMMENT = 0xffff;

export class ZipFormatError extends Error {}

export function listZipEntries(buf: Buffer): ZipEntry[] {
  const eocd = findEocd(buf);
  const total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new ZipFormatError("ZIP64 archives are not supported.");
  }
  if (cdOffset + cdSize > buf.length) throw new ZipFormatError("Corrupt archive.");

  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < total; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CDH_SIG) {
      throw new ZipFormatError("Corrupt archive.");
    }
    const compressedSize = buf.readUInt32LE(p + 20);
    const uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    if (p + 46 + nameLen > buf.length) throw new ZipFormatError("Corrupt archive.");
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    entries.push({ name, compressedSize, uncompressedSize });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function findEocd(buf: Buffer): number {
  const stop = Math.max(0, buf.length - 22 - MAX_COMMENT);
  for (let i = buf.length - 22; i >= stop; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  throw new ZipFormatError("Not a valid archive.");
}

export interface DocxLimits {
  maxEntries: number;
  maxTotalUncompressed: number;
  maxRatio: number;
}

export const DEFAULT_DOCX_LIMITS: DocxLimits = {
  maxEntries: 2000,
  maxTotalUncompressed: 200 * 1024 * 1024,
  maxRatio: 200,
};

/** Returns a user-facing reason if the DOCX must be rejected, otherwise null. */
export function vetDocx(buf: Buffer, limits: DocxLimits = DEFAULT_DOCX_LIMITS): string | null {
  let entries: ZipEntry[];
  try {
    entries = listZipEntries(buf);
  } catch (e) {
    return e instanceof ZipFormatError
      ? `This Word file looks damaged (${e.message})`
      : "This Word file looks damaged.";
  }
  if (entries.length > limits.maxEntries) return "This Word file has too many internal parts.";

  let total = 0;
  for (const e of entries) {
    total += e.uncompressedSize;
    const lower = e.name.toLowerCase();
    if (lower.includes("..") || lower.startsWith("/"))
      return "This Word file contains unsafe paths.";
    if (
      lower.endsWith("vbaproject.bin") ||
      lower.includes("/activex/") ||
      lower.includes("vbadata")
    ) {
      return "This Word file contains macros or ActiveX controls. Save it as a plain .docx and try again.";
    }
    if (lower.startsWith("word/embeddings/")) {
      return "This Word file contains embedded files. Remove them and try again.";
    }
  }
  if (total > limits.maxTotalUncompressed) return "This Word file is too large once unpacked.";
  if (total / Math.max(1, buf.length) > limits.maxRatio)
    return "This Word file is suspiciously compressed.";
  if (!entries.some((e) => e.name === "word/document.xml"))
    return "This is not a valid Word (.docx) document.";
  return null;
}
