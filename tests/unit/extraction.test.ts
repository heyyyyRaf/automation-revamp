import { describe, expect, it } from "vitest";
import {
  ExtractionError,
  MAX_TEXT_CHARS,
  csvToText,
  extractDocumentText,
} from "@/server/extraction/extract";
import { makeDocx, makeScannedPdf, makeTextPdf } from "../support/fixtures";

const opts = { ocrMaxPages: 5 };

describe("extractDocumentText", () => {
  it("reads plain text and strips the BOM / normalizes newlines", async () => {
    const r = await extractDocumentText("txt", Buffer.from("﻿line 1\r\nline 2\r\n"), opts);
    expect(r.text).toBe("line 1\nline 2");
    expect(r.ocrUsed).toBe(false);
  });

  it("reads markdown as-is (never rendered as HTML)", async () => {
    const r = await extractDocumentText("md", Buffer.from("# Login\n<script>x</script>"), opts);
    expect(r.text).toContain("<script>x</script>");
  });

  it("reads Word documents", async () => {
    const r = await extractDocumentText(
      "docx",
      makeDocx(["REQ-1: User can log in", "REQ-2: Lock after 5 failures"]),
      opts,
    );
    expect(r.text).toContain("REQ-1: User can log in");
    expect(r.text).toContain("REQ-2: Lock after 5 failures");
  });

  it("reads PDFs page by page from the text layer", async () => {
    const pdf = makeTextPdf([
      "The system shall allow users to reset their password by email link.",
      "The reset link shall expire after thirty minutes and be single use only.",
    ]);
    const r = await extractDocumentText("pdf", pdf, opts);
    expect(r.pageCount).toBe(2);
    expect(r.ocrUsed).toBe(false);
    expect(r.text).toContain("--- Page 1 ---");
    expect(r.text).toContain("reset their password");
    expect(r.text).toContain("expire after thirty minutes");
  });

  it("falls back to OCR for scanned PDFs with no text layer", async () => {
    const pdf = await makeScannedPdf("CHECKOUT PAGE");
    const r = await extractDocumentText("pdf", pdf, opts);
    expect(r.ocrUsed).toBe(true);
    expect(r.text.toUpperCase()).toMatch(/CHECKOUT/);
  }, 120_000);

  it("turns CSV rows into self-describing lines", () => {
    const text = csvToText('id,story,priority\n1,"As a user, I log in",High\n2,Logout,');
    expect(text).toContain("Columns: id, story, priority");
    expect(text).toContain("Row 1: id: 1 | story: As a user, I log in | priority: High");
    expect(text).toContain("Row 2: id: 2 | story: Logout");
  });

  it("truncates extremely long text and flags it", async () => {
    const r = await extractDocumentText("txt", Buffer.from("a".repeat(MAX_TEXT_CHARS + 10)), opts);
    expect(r.text).toHaveLength(MAX_TEXT_CHARS);
    expect(r.truncated).toBe(true);
  });

  it("throws a user-safe ExtractionError for damaged files", async () => {
    await expect(
      extractDocumentText("docx", Buffer.from("PK\x03\x04junk"), opts),
    ).rejects.toBeInstanceOf(ExtractionError);
    await expect(
      extractDocumentText("pdf", Buffer.from("%PDF-1.7\nnot really"), opts),
    ).rejects.toBeInstanceOf(ExtractionError);
  });

  it("removes NUL characters (Postgres cannot store them)", async () => {
    const r = await extractDocumentText("csv", Buffer.from("a,b\n1,2"), opts);
    expect(r.text.includes("\u0000")).toBe(false);
  });
});
