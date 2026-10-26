import { dataGuard } from "@/server/ai/prompt";

/**
 * NFR-10: AI prompts are versioned templates kept apart from the code that uses them.
 * A template is plain text with {{placeholders}}. Change the wording → bump `version`;
 * every AI call records `id@version` in AiUsage.promptVersion so results can be traced.
 */
export interface PromptTemplate {
  id: string;
  version: number;
  text: string;
}

export function promptRef(t: PromptTemplate): string {
  return `${t.id}@${t.version}`;
}

/**
 * Fills {{name}} placeholders (lower-case names). Upper-case ones such as {{STANDARD_USER}}
 * are test-data placeholders the prompt tells the model to use, and are left as they are.
 * A missing value is a programming error, so it throws.
 */
export function renderTemplate(t: PromptTemplate, vars: Record<string, string> = {}): string {
  return t.text.replace(/\{\{([a-z][a-zA-Z0-9_]*)\}\}/g, (_, name: string) => {
    const value = vars[name];
    if (value === undefined)
      throw new Error(`Prompt ${promptRef(t)} needs a value for {{${name}}}`);
    return value;
  });
}

/** System prompt = the template + the non-negotiable data-handling rules (kept in code). */
export function systemPrompt(
  t: PromptTemplate,
  boundary: string,
  vars: Record<string, string> = {},
): string {
  return `${renderTemplate(t, vars).trim()}\n\n${dataGuard(boundary)}`;
}
