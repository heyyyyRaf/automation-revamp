import mammoth from "mammoth";
import Papa from "papaparse";
import { extractText as extractPdfText, getDocumentProxy } from "unpdf";
import type { FileKind } from "@/server/uploads/validate";
import { vetDocx } from "@/server/uploads/zip-inspect";
import { ocrPdfPages } from "@/server/extraction/ocr";

/** Text cap stored per document (~1M characters). */
export const MAX_TEXT_CHARS = 1_000_000;
/** Below this many characters per page we treat a PDF as scanned and fall back to OCR. */
const MIN_CHARS_PER_PAGE = 40;
const MAX_CSV_ROWS = 10_000;

export class ExtractionError extends Error {
  constructor(readonly userMessage: string) {
    super(userMessage);
    this.name = "ExtractionError";
  }
}

export interface ExtractionResult {
  text: string;
  pageCount: number | null;
  ocrUsed: boolean;
  truncated: boolean;
}

export interface ExtractOptions {
  ocrMaxPages: number;
  signal?: AbortSignal;
}

export async function extractDocumentText(
  kind: FileKind,
  bytes: Buffer,
  options: ExtractOptions,
): Promise<ExtractionResult> {
  switch (kind) {
    case "pdf":
      return finalize(await extractPdf(bytes, options));
    case "docx":
      return finalize(await extractDocx(bytes));
    case "md":
    case "txt":
      return finalize({ text: decodeText(bytes), pageCount: null, ocrUsed: false });
    case "csv":
      return finalize({ text: csvToText(decodeText(bytes)), pageCount: null, ocrUsed: false });
    default:
      throw new ExtractionError("Text extraction is not available for this file type.");
  }
}

async function extractPdf(bytes: Buffer, options: ExtractOptions) {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    // pdf.js no longer evaluates font programs as JS (fix for CVE-2024-4367), so no eval flag is needed.
    pdf = await getDocumentProxy(new Uint8Array(bytes));
  } catch {
    throw new ExtractionError(
      "This PDF couldn't be read. It may be damaged or password-protected.",
    );
  }
  try {
    const { totalPages, text } = await extractPdfText(pdf, { mergePages: false });
    const joined = text.map((t, i) => `--- Page ${i + 1} ---\n${t.trim()}`).join("\n\n");
    const meaningful = text.reduce((n, t) => n + t.replace(/\s+/g, "").length, 0);
    if (meaningful / Math.max(1, totalPages) >= MIN_CHARS_PER_PAGE) {
      return { text: joined, pageCount: totalPages, ocrUsed: false };
    }
    // Little or no text layer: probably scanned.
    const ocrText = await ocrPdfPages(
      pdf,
      Math.min(totalPages, options.ocrMaxPages),
      options.signal,
    );
    const note =
      totalPages > options.ocrMaxPages
        ? `\n\n[Only the first ${options.ocrMaxPages} of ${totalPages} pages were read with OCR.]`
        : "";
    return { text: ocrText + note, pageCount: totalPages, ocrUsed: true };
  } finally {
    await pdf.cleanup();
  }
}

async function extractDocx(bytes: Buffer) {
  // Re-check here too: the worker never trusts that the API validated the file.
  const reason = vetDocx(bytes);
  if (reason) throw new ExtractionError(reason);
  try {
    const { value } = await mammoth.extractRawText({ buffer: bytes });
    return { text: value, pageCount: null, ocrUsed: false };
  } catch {
    throw new ExtractionError("This Word file couldn't be read. It may be damaged.");
  }
}

export function decodeText(bytes: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    throw new ExtractionError("This file isn't valid UTF-8 text.");
  }
}

/** Renders CSV rows as "Header: value" lines so each row stays self-describing for the AI. */
export function csvToText(csv: string): string {
  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: "greedy",
    preview: MAX_CSV_ROWS,
  });
  const fields = (parsed.meta.fields ?? []).filter(Boolean);
  if (fields.length === 0) return csv;
  const lines = parsed.data.map((row, i) => {
    const cells = fields
      .map((f) => [f, (row[f] ?? "").trim()] as const)
      .filter(([, v]) => v !== "")
      .map(([f, v]) => `${f}: ${v}`);
    return `Row ${i + 1}: ${cells.join(" | ")}`;
  });
  return `Columns: ${fields.join(", ")}\n${lines.join("\n")}`;
}

function finalize(r: {
  text: string;
  pageCount: number | null;
  ocrUsed: boolean;
}): ExtractionResult {
  const clean = r.text
    .replace(/\u0000/g, "") // Postgres text cannot store NUL
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
  const truncated = clean.length > MAX_TEXT_CHARS;
  return {
    text: truncated ? clean.slice(0, MAX_TEXT_CHARS) : clean,
    pageCount: r.pageCount,
    ocrUsed: r.ocrUsed,
    truncated,
  };
}
