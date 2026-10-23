import mammoth from "mammoth";
import readXlsxFile from "read-excel-file/node";
import sharp from "sharp";
import { extractText } from "unpdf";
import { describe, expect, it } from "vitest";
import { renderDocx } from "@/server/exports/render-docx";
import { pdfSafe, renderPdf } from "@/server/exports/render-pdf";
import { renderXlsx } from "@/server/exports/render-xlsx";
import { safeCell, type TestScope } from "@/server/exports/test-scope";
import {
  FigmaClient,
  isAllowedImageHost,
  parseFigmaLink,
  setFigmaFetch,
} from "@/server/figma/figma";
import { JobFailure } from "@/server/jobs/runner";

describe("Figma links", () => {
  it("parses file keys and node ids from the common URL shapes", () => {
    expect(
      parseFigmaLink("https://www.figma.com/design/AbCdEf123456/My-App?node-id=12-34&t=x"),
    ).toEqual({
      fileKey: "AbCdEf123456",
      nodeId: "12:34",
    });
    expect(parseFigmaLink("https://figma.com/file/AbCdEf123456/Name")).toEqual({
      fileKey: "AbCdEf123456",
      nodeId: null,
    });
    expect(parseFigmaLink("https://www.figma.com/proto/AbCdEf123456/x?node-id=1%3A2")?.nodeId).toBe(
      "1:2",
    );
  });

  it("rejects anything that is not an https figma.com file link", () => {
    for (const bad of [
      "http://www.figma.com/file/AbCdEf123456/x",
      "https://figma.com.evil.io/file/AbCdEf123456/x",
      "https://www.figma.com/community/plugin/123",
      "https://www.figma.com/file/../../etc",
      "javascript:alert(1)",
      "not a url",
    ]) {
      expect(parseFigmaLink(bad)).toBeNull();
    }
    expect(
      parseFigmaLink("https://www.figma.com/file/AbCdEf123456/x?node-id=evil")?.nodeId,
    ).toBeNull();
  });

  it("only downloads rendered images from Figma's own hosts", () => {
    expect(
      isAllowedImageHost("https://figma-alpha-api.s3.us-west-2.amazonaws.com/images/abc"),
    ).toBe(true);
    expect(isAllowedImageHost("https://s3-alpha.figma.com/img/abc")).toBe(true);
    expect(isAllowedImageHost("http://figma-alpha-api.s3.us-west-2.amazonaws.com/images/abc")).toBe(
      false,
    );
    expect(isAllowedImageHost("https://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isAllowedImageHost("https://evil-figma.com/x")).toBe(false);
    expect(isAllowedImageHost("https://attacker.s3.us-west-2.amazonaws.com/x")).toBe(false);
  });

  it("refuses an image URL on an unexpected host even if the Figma API returns it", async () => {
    setFigmaFetch((async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/images/")) {
        return Response.json({
          err: null,
          images: { "1:2": "https://169.254.169.254/latest/meta-data" },
        });
      }
      throw new Error(`unexpected fetch ${u}`);
    }) as typeof fetch);
    const client = new FigmaClient("token", new AbortController().signal);
    const err = await client
      .renderPngs("AbCdEf123456", [{ id: "1:2", name: "Home" }])
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JobFailure);
    expect((err as JobFailure).userMessage).toMatch(/unexpected image location/);
  });

  it("explains access problems in plain language without retrying", async () => {
    setFigmaFetch((async () => new Response("{}", { status: 403 })) as typeof fetch);
    const client = new FigmaClient("token", new AbortController().signal);
    const err = (await client
      .listFrames({ fileKey: "AbCdEf123456", nodeId: null }, 5)
      .catch((e: unknown) => e)) as JobFailure;
    expect(err.userMessage).toMatch(/denied access/);
    expect(err.retryable).toBe(false);
  });

  it("lists top-level frames and sends the token only to the Figma API", async () => {
    const seen: { url: string; token: string | null }[] = [];
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#fff" } })
      .png()
      .toBuffer();
    setFigmaFetch((async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      seen.push({ url: u, token: new Headers(init?.headers).get("x-figma-token") });
      if (u.includes("/files/")) {
        return Response.json({
          document: {
            children: [
              {
                children: [
                  { id: "1:2", name: "Login", type: "FRAME" },
                  { id: "1:3", name: "Note", type: "TEXT" },
                ],
              },
            ],
          },
        });
      }
      if (u.includes("/images/")) {
        return Response.json({
          err: null,
          images: { "1:2": "https://figma-alpha-api.s3.us-west-2.amazonaws.com/x.png" },
        });
      }
      return new Response(new Uint8Array(png), { status: 200 });
    }) as typeof fetch);
    const client = new FigmaClient("figma-secret", new AbortController().signal);
    const frames = await client.listFrames({ fileKey: "AbCdEf123456", nodeId: null }, 10);
    expect(frames).toEqual([{ id: "1:2", name: "Login" }]);
    const rendered = await client.renderPngs("AbCdEf123456", frames);
    expect(rendered).toHaveLength(1);
    const s3 = seen.find((s) => s.url.includes("amazonaws"));
    expect(s3?.token).toBeNull();
    expect(
      seen.filter((s) => s.url.includes("api.figma.com")).every((s) => s.token === "figma-secret"),
    ).toBe(true);
  });
});

const scope: TestScope = {
  project: { name: "Checkout", description: "Web shop checkout" },
  generatedAt: new Date("2026-10-23T10:00:00Z"),
  generatedBy: "Ana Tester",
  documents: [{ name: "FRD.pdf", category: "Requirements" }],
  requirements: [
    {
      key: "REQ-001",
      text: "The cart total must include VAT.",
      type: "FUNCTIONAL",
      source: "FRD.pdf",
      testCaseKeys: ["TC-001"],
      coverage: "Covered",
    },
    {
      key: "REQ-002",
      text: '=HYPERLINK("http://evil","click")',
      type: "OTHER",
      source: "Added manually",
      testCaseKeys: [],
      coverage: "Not covered",
    },
  ],
  testCases: [
    {
      key: "TC-001",
      title: "Total shows VAT → correct",
      type: "POSITIVE",
      priority: "HIGH",
      status: "APPROVED",
      automatable: true,
      requirementKeys: ["REQ-001"],
      steps: "1. Add item\n2. Open cart",
      expectedResult: "VAT included",
    },
  ],
  flows: [{ name: "Buy", steps: ["Add", "Pay"] }],
  approach: [{ label: "Requirements in scope", value: "2" }],
  environments: [],
  entryCriteria: ["Requirements reviewed."],
  exitCriteria: ["All HIGH cases executed."],
  openQuestions: [
    { question: "Which VAT rate applies?", status: "Open", answer: "", requirementKey: "REQ-001" },
  ],
};

describe("test scope exports", () => {
  it("Excel: has every sheet, the traceability matrix, and escapes formulas", async () => {
    const buf = await renderXlsx(scope);
    const sheets = await readXlsxFile(buf);
    expect(sheets.map((s) => s.sheet)).toEqual([
      "Scope",
      "Traceability",
      "Test cases",
      "Open questions",
    ]);
    const rtm = sheets.find((s) => s.sheet === "Traceability")?.data ?? [];
    expect(rtm[0]).toEqual([
      "Requirement",
      "Description",
      "Type",
      "Source",
      "Test cases",
      "Coverage",
    ]);
    expect(rtm[1]).toEqual([
      "REQ-001",
      "The cart total must include VAT.",
      "FUNCTIONAL",
      "FRD.pdf",
      "TC-001",
      "Covered",
    ]);
    expect(String(rtm[2]?.[1])).toBe('\'=HYPERLINK("http://evil","click")');
  });

  it("Word: contains all sections and the requirement text", async () => {
    const buf = await renderDocx(scope);
    const { value } = await mammoth.extractRawText({ buffer: buf });
    for (const s of [
      "Test scope — Checkout",
      "Requirements traceability matrix",
      "Entry criteria",
      "Exit criteria",
      "Open questions",
      "The cart total must include VAT.",
      "Which VAT rate applies?",
    ]) {
      expect(value).toContain(s);
    }
  });

  it("PDF: is a readable PDF with all sections", async () => {
    const buf = await renderPdf(scope);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    const { text } = await extractText(new Uint8Array(buf), { mergePages: true });
    for (const s of [
      "Test scope - Checkout",
      "Requirements traceability matrix",
      "REQ-001",
      "Exit criteria",
      "Which VAT rate applies?",
      "Total shows VAT -> correct",
    ]) {
      expect(text).toContain(s);
    }
  });

  it("helpers", () => {
    expect(safeCell("=1+1")).toBe("'=1+1");
    expect(safeCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(safeCell("normal")).toBe("normal");
    expect(pdfSafe("“quoted” → ok…")).toBe('"quoted" -> ok...');
    expect(pdfSafe("中文")).toBe("??");
  });
});
