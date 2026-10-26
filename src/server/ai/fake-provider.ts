import type { AIProvider, ProviderResult, StructuredRequest } from "@/server/ai/types";

/**
 * Offline, deterministic provider (AI_PROVIDER=fake) for tests, CI end-to-end runs and demos.
 * It produces plausible output from simple text patterns — it is not an AI.
 */
export class FakeProvider implements AIProvider {
  readonly name = "fake";
  /** Tests can override the next responses. */
  readonly queue: unknown[] = [];
  readonly calls: StructuredRequest<unknown>[] = [];

  async generate(request: StructuredRequest<unknown>): Promise<ProviderResult> {
    this.calls.push(request);
    const text = request.content.map((p) => (p.type === "text" ? p.text : "")).join("\n");
    const images = request.content.filter((p) => p.type === "image").length;
    const usage = { inputTokens: Math.ceil(text.length / 4) + images * 1500, outputTokens: 400 };

    if (this.queue.length > 0) return { raw: this.queue.shift(), usage, model: "fake" };

    switch (request.schemaName) {
      case "requirement_analysis":
        return { raw: fakeAnalysis(text), usage, model: "fake" };
      case "test_case_generation":
        return { raw: fakeTestCases(text), usage, model: "fake" };
      case "image_description":
        return {
          raw: { description: "Screen with a form: fields Name and Email, and a Submit button." },
          usage,
          model: "fake",
        };
      case "test_case_rewrite":
        return { raw: fakeRewrite(text), usage, model: "fake" };
      case "script_generation":
      case "script_fix":
        return { raw: fakeScript(text, request.schemaName === "script_fix"), usage, model: "fake" };
      default:
        return { raw: {}, usage, model: "fake" };
    }
  }
}

function dataLines(text: string): { source: string; line: string }[] {
  const out: { source: string; line: string }[] = [];
  let source = "";
  for (const raw of text.split("\n")) {
    const open = /^<<<UNTRUSTED-[0-9a-f]+ source="([^"]*)">>>$/.exec(raw);
    if (open) {
      source = (open[1] ?? "").split(":")[0] ?? "";
      continue;
    }
    if (/^<<<END UNTRUSTED/.test(raw)) {
      source = "";
      continue;
    }
    if (source && raw.trim()) out.push({ source, line: raw.trim() });
  }
  return out;
}

function fakeAnalysis(text: string) {
  const requirements = dataLines(text)
    .filter(({ line }) => /\b(shall|must|should|REQ-?\d+)\b/i.test(line) && line.length >= 10)
    .slice(0, 50)
    .map(({ source, line }, i) => ({
      ref: `R${i + 1}`,
      text: line.replace(/^[-*•]\s*/, "").slice(0, 2000),
      type: /\b(must not|invalid|reject|lock|at least|at most)/i.test(line)
        ? "VALIDATION"
        : "FEATURE",
      source,
      section: null,
    }));
  return {
    requirements,
    userFlows:
      requirements.length > 0
        ? [
            {
              name: "Main flow",
              description: "Derived from the requirements.",
              steps: requirements.slice(0, 5).map((r) => r.text.slice(0, 200)),
            },
          ]
        : [],
    openQuestions:
      requirements.length > 0
        ? [{ question: "What should happen when the action fails?", relatedRef: "R1" }]
        : [],
  };
}

function fakeCase(key: string, kind: "valid" | "invalid") {
  const valid = kind === "valid";
  return {
    title: valid ? `${key}: works with valid input` : `${key}: rejects invalid input`,
    preconditions: valid ? "User is signed in." : "None",
    steps: valid
      ? [
          { action: "Open the relevant page.", expected: null },
          { action: "Perform the action with valid data.", expected: "The action succeeds." },
        ]
      : [{ action: "Perform the action with invalid data.", expected: "An error is shown." }],
    testData: valid
      ? [{ name: "user", value: "{{STANDARD_USER}}" }]
      : [{ name: "none", value: "not needed" }],
    expectedResult: valid
      ? "The system behaves as the requirement describes."
      : "The system rejects the input with a clear message.",
    type: valid ? "POSITIVE" : "NEGATIVE",
    priority: valid ? "HIGH" : "MEDIUM",
    requirementKeys: [key],
    automatable: true,
    automatableReason: valid ? "Deterministic UI steps." : "Error message can be asserted.",
    tags: valid ? ["smoke"] : ["validation"],
  };
}

function fakeTestCases(text: string) {
  const keys = [...new Set([...text.matchAll(/\bREQ-\d{3,}\b/g)].map((m) => m[0]))];
  const existing = /source="existing scenarios">>>\n- ([^\n]+)/.exec(text)?.[1]?.trim();
  return {
    scenarios: existing
      ? []
      : [
          {
            ref: "S1",
            title: "Main flow",
            description: "The main journey through the requirements.",
            flowSteps: ["Open the app", "Complete the form", "Submit"],
          },
        ],
    testCases: keys.flatMap((key) =>
      (["valid", "invalid"] as const).map((kind) => ({
        ...fakeCase(key, kind),
        scenarioRef: existing ? `EXISTING:${existing}` : "S1",
      })),
    ),
  };
}

function fakeRewrite(text: string) {
  const key = /\bREQ-\d{3,}\b/.exec(text)?.[0] ?? "REQ-001";
  const instruction = /source="tester instruction">>>\n([^\n]+)/.exec(text)?.[1]?.trim() ?? "";
  const tc = fakeCase(key, "valid");
  return { testCase: { ...tc, title: `${tc.title} (rewritten: ${instruction.slice(0, 60)})` } };
}

/** A minimal, valid script that opens the start page and checks it loaded. */
function fakeScript(text: string, fix: boolean) {
  const title = /source="test case">>>\n([^\n]+)/.exec(text)?.[1]?.trim() ?? "TC generated test";
  const start = /The test starts at path: (\S+)/.exec(text)?.[1] ?? "/";
  const existing = /source="current script">>>\n([\s\S]*?)\n<<<END/.exec(text)?.[1];
  const code =
    fix && existing
      ? `${existing.trimEnd()}\n// Reviewed by AI fix.\n`
      : [
          'import { test, expect } from "./traxion";',
          "",
          `test(${JSON.stringify(title)}, async ({ page }) => {`,
          '  await test.step("Open the start page", async () => {',
          `    await page.goto(${JSON.stringify(start)});`,
          "  });",
          '  await expect(page.locator("body")).toBeVisible();',
          "});",
          "",
        ].join("\n");
  return {
    code,
    notes: fix
      ? "Kept the script and marked it as reviewed."
      : "Opens the start page and checks it loads.",
  };
}
