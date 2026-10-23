import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createWorker, OEM } from "tesseract.js";
import { renderPageAsImage, type getDocumentProxy } from "unpdf";

type PdfDocument = Awaited<ReturnType<typeof getDocumentProxy>>;

const require = createRequire(import.meta.url);

/** Bundled English model — OCR never downloads anything at runtime. */
function langPath(): string {
  return join(dirname(require.resolve("@tesseract.js-data/eng/package.json")), "4.0.0_best_int");
}

export async function ocrPdfPages(
  pdf: PdfDocument,
  pages: number,
  signal?: AbortSignal,
): Promise<string> {
  const worker = await createWorker("eng", OEM.LSTM_ONLY, {
    langPath: langPath(),
    gzip: true,
    cacheMethod: "none",
  });
  try {
    const out: string[] = [];
    for (let i = 1; i <= pages; i++) {
      if (signal?.aborted) throw new Error("aborted");
      const png = await renderPageAsImage(pdf, i, {
        canvasImport: () => import("@napi-rs/canvas"),
        scale: 2,
      });
      const { data } = await worker.recognize(Buffer.from(png));
      out.push(`--- Page ${i} (OCR) ---\n${data.text.trim()}`);
    }
    return out.join("\n\n");
  } finally {
    await worker.terminate();
  }
}
