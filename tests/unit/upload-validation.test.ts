import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { AppError } from "@/server/errors";
import { sanitizeDisplayName } from "@/server/uploads/filename";
import { isUtf8Text, validateUpload } from "@/server/uploads/validate";
import { vetDocx } from "@/server/uploads/zip-inspect";
import {
  docxEntries,
  fakeExe,
  makeDocx,
  makeJpegWithExif,
  makePng,
  makeTextPdf,
  makeZip,
} from "../support/fixtures";

const MB = 1024 * 1024;
const v = (bytes: Buffer, fileName: string, category = "REQUIREMENTS" as const) =>
  validateUpload({ bytes, fileName, category, maxBytes: 25 * MB });

async function rejection(p: Promise<unknown>): Promise<AppError> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  return err as AppError;
}

describe("validateUpload — accepts genuine files", () => {
  it("accepts text, markdown and CSV", async () => {
    expect((await v(Buffer.from("Login must lock after 5 tries"), "a.txt")).kind).toBe("txt");
    expect((await v(Buffer.from("# Title\n- item"), "a.md")).kind).toBe("md");
    expect((await v(Buffer.from("id,name\n1,Ana"), "a.csv")).kind).toBe("csv");
  });

  it("accepts a real PDF and DOCX", async () => {
    expect((await v(makeTextPdf(["Hello"]), "frd.pdf")).mimeType).toBe("application/pdf");
    expect((await v(makeDocx(["Hello"]), "frd.docx")).kind).toBe("docx");
  });

  it("accepts PNG and JPEG images for system flows / Figma", async () => {
    const png = await validateUpload({
      bytes: await makePng(),
      fileName: "flow.png",
      category: "SYSTEM_FLOW",
      maxBytes: 25 * MB,
    });
    expect(png.kind).toBe("png");
  });
});

describe("validateUpload — rejects unsafe or mislabeled files", () => {
  it("rejects an executable renamed to .pdf (magic bytes win over extension)", async () => {
    const err = await rejection(v(fakeExe(), "requirements.pdf"));
    expect(err.status).toBe(415);
    expect(err.message).toMatch(/doesn't match/);
  });

  it("rejects a PNG renamed to .docx", async () => {
    expect((await rejection(v(await makePng(), "spec.docx"))).status).toBe(415);
  });

  it("rejects binary content renamed to .txt", async () => {
    expect((await rejection(v(fakeExe(), "notes.txt"))).status).toBe(415);
    expect((await rejection(v(Buffer.from([0xff, 0xfe, 0x00, 0x41]), "notes.txt"))).status).toBe(
      415,
    );
  });

  it("rejects disallowed extensions and wrong categories", async () => {
    expect((await rejection(v(Buffer.from("x"), "run.exe"))).status).toBe(415);
    expect((await rejection(v(Buffer.from("<svg/>"), "x.svg"))).status).toBe(415);
    expect((await rejection(v(Buffer.from("<html>"), "x.html"))).status).toBe(415);
    const pdfAsFigma = validateUpload({
      bytes: makeTextPdf(["x"]),
      fileName: "design.pdf",
      category: "FIGMA",
      maxBytes: 25 * MB,
    });
    expect((await rejection(pdfAsFigma)).status).toBe(415);
  });

  it("rejects empty and oversized files", async () => {
    expect((await rejection(v(Buffer.alloc(0), "a.txt"))).status).toBe(415);
    const big = validateUpload({
      bytes: Buffer.alloc(26 * MB, 0x41),
      fileName: "a.txt",
      category: "REQUIREMENTS",
      maxBytes: 25 * MB,
    });
    expect((await rejection(big)).status).toBe(413);
  });

  it("rejects PDFs that contain JavaScript", async () => {
    const err = await rejection(v(makeTextPdf(["Hi"], { javascript: true }), "a.pdf"));
    expect(err.message).toMatch(/scripts/);
  });

  it("rejects a truncated / corrupt PDF", async () => {
    const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(200, 0x20)]);
    expect((await rejection(v(pdf, "a.pdf"))).status).toBe(415);
  });

  it("rejects macro-enabled Word files", async () => {
    const docm = makeDocx(["x"], [{ name: "word/vbaProject.bin", data: Buffer.from("macro") }]);
    expect((await rejection(v(docm, "a.docx"))).message).toMatch(/macros/);
  });
});

describe("images are re-encoded", () => {
  it("strips EXIF metadata from JPEGs", async () => {
    const original = await makeJpegWithExif("SECRET-OWNER");
    expect(original.includes(Buffer.from("SECRET-OWNER"))).toBe(true);
    const out = await validateUpload({
      bytes: original,
      fileName: "frame.jpg",
      category: "FIGMA",
      maxBytes: 25 * MB,
    });
    expect(out.bytes.includes(Buffer.from("SECRET-OWNER"))).toBe(false);
    expect((await sharp(out.bytes).metadata()).exif).toBeUndefined();
  });

  it("drops data appended after the image (polyglot payloads)", async () => {
    const png = Buffer.concat([await makePng(), Buffer.from("<script>alert(1)</script>")]);
    const out = await validateUpload({
      bytes: png,
      fileName: "x.png",
      category: "SYSTEM_FLOW",
      maxBytes: 25 * MB,
    });
    expect(out.bytes.includes(Buffer.from("<script>"))).toBe(false);
  });
});

describe("vetDocx (zip inspection)", () => {
  it("accepts a normal document", () => {
    expect(vetDocx(makeDocx(["a", "b"]))).toBeNull();
  });

  it("rejects zip bombs by declared uncompressed size", () => {
    const bomb = makeZip([
      ...docxEntries(["x"]),
      { name: "word/media/huge.bin", data: Buffer.from("tiny"), fakeUncompressedSize: 0xfffffff0 },
    ]);
    expect(vetDocx(bomb)).toMatch(/too large|compressed/);
  });

  it("rejects path traversal entries, ActiveX and embedded files", () => {
    expect(vetDocx(makeDocx(["x"], [{ name: "../evil.sh", data: Buffer.from("x") }]))).toMatch(
      /unsafe/,
    );
    expect(
      vetDocx(makeDocx(["x"], [{ name: "word/activeX/activeX1.bin", data: Buffer.from("x") }])),
    ).toMatch(/ActiveX/);
    expect(
      vetDocx(
        makeDocx(["x"], [{ name: "word/embeddings/oleObject1.bin", data: Buffer.from("x") }]),
      ),
    ).toMatch(/embedded/);
  });

  it("rejects archives without a Word body and non-zip data", () => {
    expect(vetDocx(makeZip([{ name: "a.txt", data: Buffer.from("x") }]))).toMatch(/not a valid/);
    expect(vetDocx(Buffer.from("not a zip at all, definitely"))).toMatch(/damaged/);
  });
});

describe("helpers", () => {
  it("sanitizeDisplayName removes paths, control and bidi characters", () => {
    expect(sanitizeDisplayName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeDisplayName("C:\\Users\\x\\spec.pdf")).toBe("spec.pdf");
    expect(sanitizeDisplayName("invoice\u202Efdp.exe")).toBe("invoicefdp.exe");
    expect(sanitizeDisplayName("a<b>:c.txt")).toBe("a_b__c.txt");
    expect(sanitizeDisplayName("...")).toBe("file");
    const long = sanitizeDisplayName(`${"a".repeat(300)}.docx`);
    expect(long).toHaveLength(200);
    expect(long.endsWith(".docx")).toBe(true);
  });

  it("isUtf8Text", () => {
    expect(isUtf8Text(Buffer.from("héllo ✓"))).toBe(true);
    expect(isUtf8Text(Buffer.from([0xc3, 0x28]))).toBe(false);
    expect(isUtf8Text(Buffer.from("a\0b"))).toBe(false);
  });
});
