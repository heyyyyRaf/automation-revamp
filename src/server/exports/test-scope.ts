import { db } from "@/server/db";

export type Coverage = "Covered" | "Draft only" | "Not covered";

/** Everything a test scope document contains, independent of output format. */
export interface TestScope {
  project: { name: string; description: string | null };
  generatedAt: Date;
  generatedBy: string;
  documents: { name: string; category: string }[];
  requirements: {
    key: string;
    text: string;
    type: string;
    source: string;
    testCaseKeys: string[];
    coverage: Coverage;
  }[];
  testCases: {
    key: string;
    title: string;
    type: string;
    priority: string;
    status: string;
    automatable: boolean;
    requirementKeys: string[];
    steps: string;
    expectedResult: string;
  }[];
  flows: { name: string; steps: string[] }[];
  approach: { label: string; value: string }[];
  environments: { name: string; baseUrl: string }[];
  entryCriteria: string[];
  exitCriteria: string[];
  openQuestions: { question: string; status: string; answer: string; requirementKey: string }[];
}

const CATEGORY_LABELS: Record<string, string> = {
  REQUIREMENTS: "Requirements",
  SYSTEM_FLOW: "System flow",
  FIGMA: "Figma design",
};

export async function buildTestScope(projectId: string, generatedBy: string): Promise<TestScope> {
  const [project, documents, requirements, testCases, flows, questions, environments] =
    await Promise.all([
      db.project.findUniqueOrThrow({ where: { id: projectId } }),
      db.document.findMany({
        where: { projectId, deletedAt: null, derivedFromId: null },
        orderBy: { createdAt: "asc" },
      }),
      db.requirement.findMany({
        where: { projectId, deletedAt: null },
        orderBy: { key: "asc" },
        include: {
          sourceDocument: { select: { originalName: true } },
          testCases: {
            include: { testCase: { select: { key: true, status: true, deletedAt: true } } },
          },
        },
      }),
      db.testCase.findMany({
        where: { projectId, deletedAt: null },
        orderBy: { key: "asc" },
        include: {
          requirements: { include: { requirement: { select: { key: true, deletedAt: true } } } },
        },
      }),
      db.userFlow.findMany({
        where: { projectId, deletedAt: null },
        orderBy: { createdAt: "asc" },
      }),
      db.openQuestion.findMany({
        where: { projectId, status: { not: "DISMISSED" } },
        orderBy: { createdAt: "asc" },
        include: { requirement: { select: { key: true } } },
      }),
      db.environment.findMany({ where: { projectId }, orderBy: { name: "asc" } }),
    ]);

  const reqRows = requirements.map((r) => {
    const linked = r.testCases
      .map((l) => l.testCase)
      .filter((t) => !t.deletedAt && t.status !== "REJECTED");
    const coverage: Coverage = linked.some((t) => t.status === "APPROVED")
      ? "Covered"
      : linked.length > 0
        ? "Draft only"
        : "Not covered";
    return {
      key: r.key,
      text: r.text,
      type: r.type,
      source:
        [r.sourceDocument?.originalName, r.sourceSection].filter(Boolean).join(" — ") ||
        "Added manually",
      testCaseKeys: linked.map((t) => t.key).sort(),
      coverage,
    };
  });

  const count = <T>(items: T[], pick: (t: T) => string) =>
    items.reduce<Record<string, number>>((acc, t) => {
      acc[pick(t)] = (acc[pick(t)] ?? 0) + 1;
      return acc;
    }, {});
  const byType = count(testCases, (t) => t.type);
  const byStatus = count(testCases, (t) => t.status);
  const covered = reqRows.filter((r) => r.coverage === "Covered").length;
  const automatable = testCases.filter((t) => t.automatable).length;

  return {
    project: { name: project.name, description: project.description },
    generatedAt: new Date(),
    generatedBy,
    documents: documents.map((d) => ({
      name: d.originalName,
      category: CATEGORY_LABELS[d.category] ?? d.category,
    })),
    requirements: reqRows,
    testCases: testCases.map((t) => ({
      key: t.key,
      title: t.title,
      type: t.type,
      priority: t.priority,
      status: t.status,
      automatable: t.automatable,
      requirementKeys: t.requirements
        .filter((l) => !l.requirement.deletedAt)
        .map((l) => l.requirement.key),
      steps: stepsToText(t.steps),
      expectedResult: t.expectedResult,
    })),
    flows: flows.map((f) => ({
      name: f.name,
      steps: Array.isArray(f.steps) ? f.steps.map(String) : [],
    })),
    approach: [
      { label: "Requirements in scope", value: String(reqRows.length) },
      {
        label: "Requirements covered by approved test cases",
        value: reqRows.length
          ? `${covered} of ${reqRows.length} (${Math.round((covered / reqRows.length) * 100)}%)`
          : "0",
      },
      { label: "Test cases", value: String(testCases.length) },
      {
        label: "By type",
        value: `Positive ${byType["POSITIVE"] ?? 0} · Negative ${byType["NEGATIVE"] ?? 0} · Boundary ${byType["BOUNDARY"] ?? 0}`,
      },
      {
        label: "By status",
        value: `Approved ${byStatus["APPROVED"] ?? 0} · Draft ${byStatus["DRAFT"] ?? 0} · Rejected ${byStatus["REJECTED"] ?? 0}`,
      },
      {
        label: "Candidates for automation (Playwright)",
        value: `${automatable} of ${testCases.length}`,
      },
      {
        label: "Method",
        value:
          "Requirements-based functional testing with positive, negative and boundary cases. Automatable, approved cases are scripted with Playwright; the rest are run manually.",
      },
    ],
    environments: environments.map((e) => ({ name: e.name, baseUrl: e.baseUrl })),
    entryCriteria: [
      "Requirements in scope are reviewed and open questions affecting them are answered.",
      "Test cases are approved by a QA tester.",
      "The test environment is deployed, reachable and its test accounts are verified.",
      "Test data is prepared and does not contain production personal data.",
    ],
    exitCriteria: [
      "All approved HIGH-priority test cases have been executed.",
      "No open critical or high-severity defects remain, or they are accepted by the product owner.",
      "Every in-scope requirement is covered by at least one executed test case.",
      "The test report has been reviewed and shared with stakeholders.",
    ],
    openQuestions: questions.map((q) => ({
      question: q.question,
      status: q.status === "ANSWERED" ? "Answered" : "Open",
      answer: q.answer ?? "",
      requirementKey: q.requirement?.key ?? "",
    })),
  };
}

function stepsToText(steps: unknown): string {
  if (!Array.isArray(steps)) return "";
  return steps
    .map((s, i) => {
      const step = s as { action?: unknown; expected?: unknown };
      const expected =
        typeof step.expected === "string" && step.expected ? ` (expected: ${step.expected})` : "";
      return `${i + 1}. ${String(step.action ?? "")}${expected}`;
    })
    .join("\n");
}

/** Spreadsheet apps execute cells starting with these characters as formulas (CSV/formula injection). */
export function safeCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}
