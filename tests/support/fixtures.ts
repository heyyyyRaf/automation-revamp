/** Builds real test files in memory (PDF, DOCX, images, zips) so no binary fixtures are committed. */
import { crc32, deflateSync } from "node:zlib";
import sharp from "sharp";

// ── ZIP / DOCX ──────────────────────────────────────────────────────────────

export interface ZipInput {
  name: string;
  data: Buffer;
  /** Lie about the size in the central directory (zip-bomb simulation). */
  fakeUncompressedSize?: number;
}

/** Minimal ZIP writer (stored, no compression). */
export function makeZip(entries: ZipInput[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const crc = crc32(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(e.data.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, e.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(e.data.length, 20);
    central.writeUInt32LE(e.fakeUncompressedSize ?? e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + e.data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const xml = (s: string) =>
  Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${s}`);

export function docxEntries(paragraphs: string[]): ZipInput[] {
  const body = paragraphs
    .map(
      (p) => `<w:p><w:r><w:t>${p.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</w:t></w:r></w:p>`,
    )
    .join("");
  return [
    {
      name: "[Content_Types].xml",
      data: xml(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
    },
    {
      name: "_rels/.rels",
      data: xml(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      ),
    },
    {
      name: "word/document.xml",
      data: xml(
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
      ),
    },
  ];
}

export function makeDocx(paragraphs: string[], extra: ZipInput[] = []): Buffer {
  return makeZip([...docxEntries(paragraphs), ...extra]);
}

// ── PDF ─────────────────────────────────────────────────────────────────────

function pdfEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** Assembles a PDF from object bodies (1-based ids), computing the xref table. */
function assemblePdf(objects: Buffer[], rootId = 1): Buffer {
  const parts: Buffer[] = [Buffer.from("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n", "latin1")];
  let length = parts[0]!.length;
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(length);
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), body, Buffer.from("\nendobj\n")]);
    parts.push(chunk);
    length += chunk.length;
  });
  const xrefStart = length;
  const xref =
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("") +
    `trailer\n<< /Size ${objects.length + 1} /Root ${rootId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  parts.push(Buffer.from(xref));
  return Buffer.concat(parts);
}

function stream(dict: string, data: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`<< ${dict} /Length ${data.length} >>\nstream\n`),
    data,
    Buffer.from("\nendstream"),
  ]);
}

/** One page per string, with a real text layer. */
export function makeTextPdf(pages: string[], options: { javascript?: boolean } = {}): Buffer {
  const objs: Buffer[] = [];
  const font = 3;
  const jsId = options.javascript ? 4 : 0;
  const firstPage = options.javascript ? 5 : 4;
  const kids = pages.map((_, i) => `${firstPage + i * 2} 0 R`).join(" ");

  const names = options.javascript
    ? ` /Names << /JavaScript << /Names [(init) ${jsId} 0 R] >> >>`
    : "";
  objs.push(Buffer.from(`<< /Type /Catalog /Pages 2 0 R${names} >>`));
  objs.push(Buffer.from(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`));
  objs.push(Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"));
  if (options.javascript) objs.push(Buffer.from("<< /S /JavaScript /JS (app.alert\\(1\\)) >>"));
  pages.forEach((text, i) => {
    const contentId = firstPage + i * 2 + 1;
    objs.push(
      Buffer.from(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${contentId} 0 R >>`,
      ),
    );
    const lines = text
      .split("\n")
      .map((l, j) => `BT /F1 14 Tf 72 ${720 - j * 20} Td (${pdfEscape(l)}) Tj ET`)
      .join("\n");
    objs.push(stream("", Buffer.from(lines)));
  });
  return assemblePdf(objs);
}

/** A "scanned" PDF: the page is a single image of rendered text, with no text layer. */
export async function makeScannedPdf(text: string): Promise<Buffer> {
  const width = 1200;
  const height = 400;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="white"/>
    <text x="60" y="220" font-family="Arial, Helvetica, sans-serif" font-size="96" fill="black">${text}</text>
  </svg>`;
  const raw = await sharp(Buffer.from(svg)).removeAlpha().raw().toBuffer();
  const objs: Buffer[] = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width / 2} ${height / 2}] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>`,
    ),
    stream(
      `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode`,
      deflateSync(raw),
    ),
    stream("", Buffer.from(`q ${width / 2} 0 0 ${height / 2} 0 0 cm /Im1 Do Q`)),
  ];
  return assemblePdf(objs);
}

// ── Images ──────────────────────────────────────────────────────────────────

export function makePng(): Promise<Buffer> {
  return sharp({
    create: { width: 40, height: 30, channels: 3, background: { r: 37, g: 99, b: 235 } },
  })
    .png()
    .toBuffer();
}

export function makeJpegWithExif(secret: string): Promise<Buffer> {
  return sharp({
    create: { width: 40, height: 30, channels: 3, background: { r: 200, g: 50, b: 50 } },
  })
    .withExif({ IFD0: { Copyright: secret, Artist: secret } })
    .jpeg()
    .toBuffer();
}

/** Windows PE header — what an .exe renamed to .pdf looks like. */
export function fakeExe(): Buffer {
  const b = Buffer.alloc(256);
  b.write("MZ", 0, "latin1");
  b.writeUInt32LE(0x80, 0x3c);
  b.write("PE\0\0", 0x80, "latin1");
  return b;
}
