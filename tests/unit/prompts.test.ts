import { describe, expect, it } from "vitest";
import * as library from "@/server/ai/prompts/library";
import {
  promptRef,
  renderTemplate,
  systemPrompt,
  type PromptTemplate,
} from "@/server/ai/prompts/template";

const templates = Object.values(library) as PromptTemplate[];

describe("prompt library (NFR-10)", () => {
  it("has unique ids, each with a version", () => {
    const ids = templates.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of templates) {
      expect(t.version).toBeGreaterThanOrEqual(1);
      expect(promptRef(t)).toBe(`${t.id}@${t.version}`);
    }
  });

  it("renders every template with its variables", () => {
    for (const t of templates) {
      const text = renderTemplate(t, { kind: "flow diagram" });
      expect(text).not.toMatch(/\{\{[a-z]/);
    }
  });

  it("keeps upper-case test-data placeholders for the model", () => {
    expect(renderTemplate(library.GENERATION_PROMPT)).toContain("{{STANDARD_USER}}");
  });

  it("throws on a missing variable", () => {
    expect(() => renderTemplate(library.DESCRIBE_IMAGE_PROMPT)).toThrow(/needs a value/);
  });

  it("always appends the data-handling rules with the call's boundary", () => {
    const text = systemPrompt(library.ANALYSIS_PROMPT, "UNTRUSTED-abc123abc123");
    expect(text).toContain("UNTRUSTED-abc123abc123");
  });
});
