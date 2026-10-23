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
      type: /\b(secure|password|encrypt|lock)/i.test(line) ? "SECURITY" : "FUNCTIONAL",
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

function fakeTestCases(text: string) {
  const keys = [...new Set([...text.matchAll(/\bREQ-\d{3,}\b/g)].map((m) => m[0]))];
  return {
    testCases: keys.flatMap((key) => [
      {
        title: `${key}: works with valid input`,
        preconditions: "User is signed in.",
        steps: [
          { action: "Open the relevant page.", expected: null },
          { action: "Perform the action with valid data.", expected: "The action succeeds." },
        ],
        testData: [{ name: "user", value: "{{STANDARD_USER}}" }],
        expectedResult: "The system behaves as the requirement describes.",
        type: "POSITIVE",
        priority: "HIGH",
        requirementKeys: [key],
        automatable: true,
        automatableReason: "Deterministic UI steps.",
      },
      {
        title: `${key}: rejects invalid input`,
        preconditions: null,
        steps: [
          { action: "Perform the action with invalid data.", expected: "An error is shown." },
        ],
        testData: [],
        expectedResult: "The system rejects the input with a clear message.",
        type: "NEGATIVE",
        priority: "MEDIUM",
        requirementKeys: [key],
        automatable: true,
        automatableReason: "Error message can be asserted.",
      },
    ]),
  };
}
