import writeXlsxFile, { type Row } from "write-excel-file/node";
import { safeCell, type TestScope } from "@/server/exports/test-scope";

const header = (labels: string[]): Row =>
  labels.map((value) => ({ value, fontWeight: "bold" as const, backgroundColor: "#EFF6FF" }));

/** All user-derived strings go through safeCell and are written as text, never formulas. */
const text = (value: string): Row[number] => ({ value: safeCell(value), type: String, wrap: true });

export async function renderXlsx(scope: TestScope): Promise<Buffer> {
  const summary: Row[] = [
    [{ value: `Test scope — ${safeCell(scope.project.name)}`, fontWeight: "bold", fontSize: 14 }],
    [text(scope.project.description ?? "")],
    [
      `Generated ${scope.generatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC by`,
      text(scope.generatedBy),
    ],
    [],
    header(["Approach", ""]),
    ...scope.approach.map((a) => [text(a.label), text(a.value)]),
    [],
    header(["Documents in scope", "Type"]),
    ...scope.documents.map((d) => [text(d.name), text(d.category)]),
    [],
    header(["Environments", "Base URL"]),
    ...(scope.environments.length
      ? scope.environments.map((e) => [text(e.name), text(e.baseUrl)])
      : [[text("To be configured"), null]]),
    [],
    header(["Entry criteria", ""]),
    ...scope.entryCriteria.map((c) => [text(c), null]),
    [],
    header(["Exit criteria", ""]),
    ...scope.exitCriteria.map((c) => [text(c), null]),
  ];

  const rtm: Row[] = [
    header(["Requirement", "Description", "Type", "Source", "Test cases", "Coverage"]),
    ...scope.requirements.map((r) => [
      text(r.key),
      text(r.text),
      text(r.type),
      text(r.source),
      text(r.testCaseKeys.join(", ")),
      text(r.coverage),
    ]),
  ];

  const cases: Row[] = [
    header([
      "Test case",
      "Title",
      "Type",
      "Priority",
      "Status",
      "Automatable",
      "Requirements",
      "Steps",
      "Expected result",
    ]),
    ...scope.testCases.map((t) => [
      text(t.key),
      text(t.title),
      text(t.type),
      text(t.priority),
      text(t.status),
      text(t.automatable ? "Yes" : "No"),
      text(t.requirementKeys.join(", ")),
      text(t.steps),
      text(t.expectedResult),
    ]),
  ];

  const questions: Row[] = [
    header(["Question", "Requirement", "Status", "Answer"]),
    ...scope.openQuestions.map((q) => [
      text(q.question),
      text(q.requirementKey),
      text(q.status),
      text(q.answer),
    ]),
  ];

  return writeXlsxFile([
    { sheet: "Scope", data: summary, columns: [{ width: 50 }, { width: 70 }] },
    {
      sheet: "Traceability",
      data: rtm,
      columns: [
        { width: 12 },
        { width: 70 },
        { width: 16 },
        { width: 30 },
        { width: 24 },
        { width: 14 },
      ],
      stickyRowsCount: 1,
    },
    {
      sheet: "Test cases",
      data: cases,
      columns: [
        { width: 10 },
        { width: 45 },
        { width: 11 },
        { width: 10 },
        { width: 11 },
        { width: 12 },
        { width: 18 },
        { width: 70 },
        { width: 45 },
      ],
      stickyRowsCount: 1,
    },
    {
      sheet: "Open questions",
      data: questions,
      columns: [{ width: 70 }, { width: 14 }, { width: 11 }, { width: 60 }],
      stickyRowsCount: 1,
    },
  ]).toBuffer();
}
