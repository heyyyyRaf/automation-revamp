import PDFDocument from "pdfkit";
import type { TestScope } from "@/server/exports/test-scope";

const ACCENT = "#1E40AF";

/** The built-in PDF fonts only cover Latin-1: map common symbols and drop anything else. */
export function pdfSafe(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/→/g, "->")
    .replace(/…/g, "...")
    .replace(/·|•/g, "-")
    .normalize("NFC")
    .replace(/[^\n\t -ÿ]/g, "?");
}

export function renderPdf(scope: TestScope): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 48,
      bufferPages: true,
      info: { Title: pdfSafe(`Test scope - ${scope.project.name}`), Creator: "Traxion QA" },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const heading = (text: string) => {
      doc.moveDown(1).font("Helvetica-Bold").fontSize(14).fillColor(ACCENT).text(pdfSafe(text));
      doc.moveDown(0.4).font("Helvetica").fontSize(10).fillColor("black");
    };
    const para = (text: string) =>
      doc.font("Helvetica").fontSize(10).text(pdfSafe(text)).moveDown(0.3);
    const bullets = (items: string[]) => items.forEach((i) => para(`- ${i}`));
    const table = (headers: string[], rows: string[][], widths?: (number | string)[]) => {
      doc.fontSize(8.5);
      doc.table({
        columnStyles: widths ?? headers.map(() => "*"),
        rowStyles: (i) => (i === 0 ? { backgroundColor: "#EFF6FF" } : undefined),
        data: [
          headers.map((h) => ({ text: pdfSafe(h), font: { src: "Helvetica-Bold" } })),
          ...rows.map((r) => r.map((c) => pdfSafe(c))),
        ],
      });
      doc.fontSize(10).moveDown(0.5);
      doc.x = doc.page.margins.left;
    };

    doc
      .font("Helvetica-Bold")
      .fontSize(20)
      .fillColor(ACCENT)
      .text(pdfSafe(`Test scope - ${scope.project.name}`));
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor("#475569")
      .text(
        pdfSafe(
          `Generated ${scope.generatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC by ${scope.generatedBy}`,
        ),
      );
    doc.fillColor("black").fontSize(10).moveDown(0.5);
    if (scope.project.description) para(scope.project.description);

    heading("1. Scope");
    para(
      `${scope.requirements.length} requirements from ${scope.documents.length} documents are in scope.`,
    );
    if (scope.documents.length)
      table(
        ["Document", "Type"],
        scope.documents.map((d) => [d.name, d.category]),
        ["*", 120],
      );

    heading("2. Requirements traceability matrix");
    if (scope.requirements.length) {
      table(
        ["Req.", "Description", "Test cases", "Coverage"],
        scope.requirements.map((r) => [
          r.key,
          r.text,
          r.testCaseKeys.join(", ") || "-",
          r.coverage,
        ]),
        [55, "*", 90, 70],
      );
    } else para("No requirements yet.");

    heading("3. Test approach");
    table(
      ["Item", "Value"],
      scope.approach.map((a) => [a.label, a.value]),
      [180, "*"],
    );
    if (scope.flows.length) {
      para("Key user flows:");
      bullets(scope.flows.map((f) => `${f.name}: ${f.steps.join(" -> ")}`));
    }

    heading("4. Environments");
    if (scope.environments.length)
      table(
        ["Environment", "Base URL"],
        scope.environments.map((e) => [e.name, e.baseUrl]),
      );
    else para("To be configured.");

    heading("5. Entry criteria");
    bullets(scope.entryCriteria);
    heading("6. Exit criteria");
    bullets(scope.exitCriteria);

    heading("7. Open questions");
    if (scope.openQuestions.length) {
      table(
        ["Question", "Req.", "Status", "Answer"],
        scope.openQuestions.map((q) => [q.question, q.requirementKey, q.status, q.answer]),
        ["*", 55, 60, "*"],
      );
    } else para("None.");

    if (scope.testCases.length) {
      doc.addPage();
      heading("Appendix - Test cases");
      table(
        ["ID", "Title", "Type", "Priority", "Status", "Requirements"],
        scope.testCases.map((t) => [
          t.key,
          t.title,
          t.type,
          t.priority,
          t.status,
          t.requirementKeys.join(", "),
        ]),
        [45, "*", 60, 50, 60, 80],
      );
    }

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor("#64748B")
        .text(`Page ${i + 1} of ${range.count}`, doc.page.margins.left, doc.page.height - 32, {
          align: "right",
          width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
          lineBreak: false,
        });
    }
    doc.end();
  });
}
