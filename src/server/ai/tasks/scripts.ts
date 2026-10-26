import { z } from "zod";
import { untrusted } from "@/server/ai/prompt";
import type { DomSnapshotData } from "@/server/sandbox/protocol";

export const scriptOutputSchema = z.object({
  code: z.string().min(20).max(100_000),
  notes: z.string().max(3000),
});
export type ScriptOutput = z.infer<typeof scriptOutputSchema>;

/** Compact description of one captured page (bounded size). */
export function describePage(dom: DomSnapshotData): string {
  const elements = dom.elements
    .slice(0, 200)
    .map((e) =>
      [
        e.role ?? e.tag,
        e.name && `name="${e.name}"`,
        e.label && e.label !== e.name && `label="${e.label}"`,
        e.placeholder && `placeholder="${e.placeholder}"`,
        e.testId && `testId="${e.testId}"`,
      ]
        .filter(Boolean)
        .join(" "),
    )
    .join("\n");
  return `URL: ${dom.url}\nTitle: ${dom.title}\n\nAccessibility tree:\n${dom.aria.slice(0, 20_000)}\n\nInteractive elements:\n${elements}`;
}

/** All captured pages as one snapshot, for the selector check (FR-6.2). */
export function mergeSnapshots(doms: DomSnapshotData[]): DomSnapshotData | null {
  if (doms.length === 0) return null;
  return {
    url: doms
      .map((d) => d.url)
      .join(" | ")
      .slice(0, 2000),
    title: doms
      .map((d) => d.title)
      .join(" | ")
      .slice(0, 500),
    aria: doms
      .map((d) => d.aria)
      .join("\n")
      .slice(0, 80_000),
    elements: doms.flatMap((d) => d.elements).slice(0, 600),
  };
}

export interface ScriptContext {
  testCase: {
    key: string;
    title: string;
    preconditions: string | null;
    steps: { action: string; expected?: string | null }[];
    testData: Record<string, string>;
    expectedResult: string;
  };
  startPath: string;
  accountLabels: string[];
  variableNames: string[];
  pages: DomSnapshotData[];
}

function testCaseText(tc: ScriptContext["testCase"]): string {
  return [
    `${tc.key} ${tc.title}`,
    tc.preconditions ? `Preconditions: ${tc.preconditions}` : "",
    "Steps:",
    ...tc.steps.map(
      (s, i) => `${i + 1}. ${s.action}${s.expected ? ` → expected: ${s.expected}` : ""}`,
    ),
    `Expected result: ${tc.expectedResult}`,
    Object.keys(tc.testData).length
      ? `Test data: ${Object.entries(tc.testData)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Everything user- or page-derived goes inside untrusted blocks. Account labels and
 * variable NAMES only — never values (credentials never reach the AI, NFR-1).
 */
export function scriptContent(boundary: string, ctx: ScriptContext): string {
  return [
    `The test starts at path: ${ctx.startPath}`,
    `Available account labels: ${ctx.accountLabels.length ? ctx.accountLabels.map((l) => JSON.stringify(l)).join(", ") : "(none)"}`,
    `Available variable names: ${ctx.variableNames.length ? ctx.variableNames.join(", ") : "(none)"}`,
    "",
    untrusted(boundary, "test case", testCaseText(ctx.testCase)),
    "",
    ...(ctx.pages.length
      ? ctx.pages.map((p, i) => untrusted(boundary, `captured page ${i + 1}`, describePage(p)))
      : ["(no page could be captured)"]),
  ].join("\n");
}

/** Input for SCRIPT_FIX_PROMPT: the current file, what is wrong, and the context. */
export function fixContent(
  boundary: string,
  ctx: ScriptContext,
  currentCode: string,
  problems: string[],
  instruction: string | null,
): string {
  return [
    scriptContent(boundary, ctx),
    "",
    untrusted(boundary, "current script", currentCode),
    "",
    untrusted(
      boundary,
      "problems to fix",
      problems.length ? problems.map((p) => `- ${p}`).join("\n") : "(none reported)",
    ),
    ...(instruction ? ["", untrusted(boundary, "tester instruction", instruction)] : []),
  ].join("\n");
}
