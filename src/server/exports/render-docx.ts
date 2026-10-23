import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import type { TestScope } from "@/server/exports/test-scope";

const h1 = (text: string) =>
  new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 120 } });
const p = (text: string) =>
  new Paragraph({ children: [new TextRun(text)], spacing: { after: 80 } });
const bullet = (text: string) => new Paragraph({ text, bullet: { level: 0 } });

function table(headers: string[], rows: string[][]): Table {
  const cell = (text: string, bold = false) =>
    new TableCell({
      children: text
        .split("\n")
        .map((line) => new Paragraph({ children: [new TextRun({ text: line, bold, size: 18 })] })),
      ...(bold ? { shading: { type: ShadingType.CLEAR, fill: "EFF6FF", color: "auto" } } : {}),
    });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((h) => cell(h, true)) }),
      ...rows.map((r) => new TableRow({ children: r.map((c) => cell(c)) })),
    ],
  });
}

/** Text is inserted as runs (never parsed), so document content cannot inject markup. */
export async function renderDocx(scope: TestScope): Promise<Buffer> {
  const doc = new Document({
    title: `Test scope — ${scope.project.name}`,
    creator: "Traxion QA",
    styles: { default: { document: { run: { font: "Calibri", size: 21 } } } },
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.TITLE,
            alignment: AlignmentType.LEFT,
            children: [new TextRun(`Test scope — ${scope.project.name}`)],
          }),
          p(
            `Generated ${scope.generatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC by ${scope.generatedBy}`,
          ),
          ...(scope.project.description ? [p(scope.project.description)] : []),

          h1("1. Scope"),
          p(
            `${scope.requirements.length} requirements from ${scope.documents.length} documents are in scope.`,
          ),
          table(
            ["Document", "Type"],
            scope.documents.map((d) => [d.name, d.category]),
          ),

          h1("2. Requirements traceability matrix"),
          table(
            ["Requirement", "Description", "Test cases", "Coverage"],
            scope.requirements.map((r) => [
              r.key,
              r.text,
              r.testCaseKeys.join(", ") || "—",
              r.coverage,
            ]),
          ),

          h1("3. Test approach"),
          table(
            ["Item", "Value"],
            scope.approach.map((a) => [a.label, a.value]),
          ),
          ...(scope.flows.length
            ? [
                p("Key user flows:"),
                ...scope.flows.map((f) => bullet(`${f.name}: ${f.steps.join(" → ")}`)),
              ]
            : []),

          h1("4. Environments"),
          ...(scope.environments.length
            ? [
                table(
                  ["Environment", "Base URL"],
                  scope.environments.map((e) => [e.name, e.baseUrl]),
                ),
              ]
            : [p("To be configured.")]),

          h1("5. Entry criteria"),
          ...scope.entryCriteria.map(bullet),
          h1("6. Exit criteria"),
          ...scope.exitCriteria.map(bullet),

          h1("7. Open questions"),
          ...(scope.openQuestions.length
            ? [
                table(
                  ["Question", "Requirement", "Status", "Answer"],
                  scope.openQuestions.map((q) => [
                    q.question,
                    q.requirementKey,
                    q.status,
                    q.answer,
                  ]),
                ),
              ]
            : [p("None.")]),

          h1("Appendix — Test cases"),
          table(
            ["Test case", "Title", "Type", "Priority", "Status", "Requirements"],
            scope.testCases.map((t) => [
              t.key,
              t.title,
              t.type,
              t.priority,
              t.status,
              t.requirementKeys.join(", "),
            ]),
          ),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}
