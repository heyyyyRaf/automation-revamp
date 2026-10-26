import sharp from "sharp";
import { db } from "@/server/db";
import { renderReportHtml } from "@/server/exports/render-report-html";
import { runInSandbox } from "@/server/sandbox/sandbox";
import type { RunReport } from "@/server/services/reports";
import { getStorage } from "@/server/storage/storage";

/** Keeps the page well under the sandbox's 11 MB input limit. */
const MAX_SHOTS = 40;

/** Failure screenshots, downscaled, as data: URLs keyed by run test id. */
export async function reportScreenshots(report: RunReport): Promise<Map<string, string>> {
  const ids = report.failures
    .filter((f) => f.hasScreenshot)
    .slice(0, MAX_SHOTS)
    .map((f) => f.runTestId);
  const tests = await db.runTest.findMany({
    where: { id: { in: ids }, runId: report.run.id },
    select: { id: true, screenshotKey: true },
  });
  const out = new Map<string, string>();
  for (const t of tests) {
    if (!t.screenshotKey) continue;
    try {
      const jpeg = await sharp(await getStorage().get(t.screenshotKey))
        .resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 65 })
        .toBuffer();
      out.set(t.id, `data:image/jpeg;base64,${jpeg.toString("base64")}`);
    } catch {
      // A missing or broken screenshot leaves the "No screenshot" box.
    }
  }
  return out;
}

export async function renderReportPage(report: RunReport): Promise<string> {
  return renderReportHtml(report, await reportScreenshots(report));
}

/**
 * FR-9.4 PDF: Chromium prints the page inside a sandbox with no network at all (no origins
 * granted, every request but data: refused), so report content can't reach anything.
 */
export async function printReportPdf(
  html: string,
  sessionId: string,
  signal?: AbortSignal,
): Promise<Buffer> {
  const parts: string[] = [];
  let finished = false;
  let error: string | null = null;
  for await (const event of runInSandbox({
    sessionId,
    label: `pdf:${sessionId}`,
    origins: [],
    input: {
      mode: "pdf",
      baseURL: "http://localhost.invalid",
      storageState: null,
      accounts: {},
      vars: {},
      testTimeoutMs: 120_000,
      retries: 0,
      slowMoMs: 0,
      tests: [],
      pdf: { html },
    },
    timeoutMs: 180_000,
    signal,
  })) {
    if (event.t === "pdf") {
      if (event.seq !== parts.length) throw new Error("PDF arrived out of order.");
      parts.push(event.data);
      if (event.last) finished = true;
    } else if (event.t === "done") {
      if (!event.ok) error = event.error ?? "The PDF couldn't be printed.";
    }
  }
  if (error) throw new Error(error);
  if (!finished) throw new Error("The PDF couldn't be printed.");
  const pdf = Buffer.from(parts.join(""), "base64");
  if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-")
    throw new Error("The printer returned something that isn't a PDF.");
  return pdf;
}
