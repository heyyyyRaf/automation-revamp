import { z } from "zod";
import { dataGuard, untrusted } from "@/server/ai/prompt";
import type { DomSnapshotData } from "@/server/sandbox/protocol";

export const scriptOutputSchema = z.object({
  code: z.string().min(20).max(100_000),
  notes: z.string().max(3000),
});
export type ScriptOutput = z.infer<typeof scriptOutputSchema>;

const RULES = [
  "Write ONE Playwright test file in TypeScript. Rules:",
  '- First line: import { test, expect, account, vars } from "./traxion"; (import only what you use).',
  "- Do not import anything else. No Node.js APIs (fs, process, require, fetch), no eval, no page.evaluate with strings.",
  '- Use only the `page` fixture: test("<KEY> <title>", async ({ page }) => { ... }).',
  '- Navigate with paths relative to the environment, e.g. await page.goto("/cart"). Never absolute URLs.',
  "- Prefer locators that exist in the page snapshot: getByRole(role, { name }), getByLabel, getByTestId,",
  "  getByPlaceholder, getByText. Avoid CSS/XPath unless nothing else identifies the element.",
  '- Wrap each manual step in await test.step("<step text>", async () => { ... }).',
  "- Assert every expected result with expect(...) web-first assertions (toBeVisible, toHaveText, toHaveURL).",
  "- Never use page.waitForTimeout or fixed sleeps.",
  '- Credentials: const user = account("<label>"); then user.username / user.password.',
  "  Use only the account labels listed. Map placeholders like {{STANDARD_USER}} to the closest label.",
  "- Non-secret settings: vars.NAME (only the names listed).",
  "- notes: one short paragraph for the tester (assumptions, elements not on the captured page).",
].join("\n");

export function scriptSystemPrompt(boundary: string): string {
  return [
    "You are a senior test automation engineer writing Playwright tests.",
    "",
    RULES,
    "",
    dataGuard(boundary),
  ].join("\n");
}

export function fixSystemPrompt(boundary: string): string {
  return [
    "You are a senior test automation engineer fixing a Playwright test.",
    "Return the complete corrected file in `code` and a short explanation in `notes`.",
    "Keep everything that already works; change only what is needed.",
    "",
    RULES,
    "",
    dataGuard(boundary),
  ].join("\n");
}

/** Compact page description for the prompt (bounded size). */
export function describePage(dom: DomSnapshotData | null): string {
  if (!dom) return "(no page snapshot available)";
  const elements = dom.elements
    .slice(0, 250)
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
  return `URL: ${dom.url}\nTitle: ${dom.title}\n\nAccessibility tree:\n${dom.aria.slice(0, 30_000)}\n\nInteractive elements:\n${elements}`;
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
  dom: DomSnapshotData | null;
}

/** Everything user- or page-derived goes inside untrusted blocks. Labels/names only — never values. */
export function scriptContent(boundary: string, ctx: ScriptContext): string {
  const tc = ctx.testCase;
  const testCaseText = [
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
  return [
    `The test starts at path: ${ctx.startPath}`,
    `Available account labels: ${ctx.accountLabels.length ? ctx.accountLabels.map((l) => JSON.stringify(l)).join(", ") : "(none)"}`,
    `Available variable names: ${ctx.variableNames.length ? ctx.variableNames.join(", ") : "(none)"}`,
    "",
    untrusted(boundary, "test case", testCaseText),
    "",
    untrusted(boundary, "captured start page", describePage(ctx.dom)),
  ].join("\n");
}
