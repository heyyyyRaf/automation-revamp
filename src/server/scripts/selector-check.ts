import ts from "typescript";
import type { DomElement, DomSnapshotData } from "@/server/sandbox/protocol";

export type SelectorStatus = "found" | "missing" | "unchecked";

export interface SelectorResult {
  line: number;
  selector: string;
  status: SelectorStatus;
  note: string | null;
}

const LOCATOR_METHODS = new Set([
  "getByRole",
  "getByLabel",
  "getByText",
  "getByPlaceholder",
  "getByTestId",
  "getByTitle",
  "getByAltText",
  "locator",
]);

type Matcher = string | RegExp;

function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Playwright semantics: exact = full match; otherwise case-insensitive substring. RegExp = test. */
function matches(query: Matcher, value: string | null, exact: boolean): boolean {
  if (!value) return false;
  if (query instanceof RegExp) return query.test(value);
  return exact
    ? value.replace(/\s+/g, " ").trim() === query.trim()
    : norm(value).includes(norm(query));
}

function literal(node: ts.Expression | undefined): Matcher | null {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isRegularExpressionLiteral(node)) {
    const m = /^\/(.*)\/([a-z]*)$/s.exec(node.text);
    try {
      return m ? new RegExp(m[1] ?? "", (m[2] ?? "").replace(/[gy]/g, "")) : null;
    } catch {
      return null;
    }
  }
  return null;
}

function option(node: ts.Expression | undefined, key: string): ts.Expression | undefined {
  if (!node || !ts.isObjectLiteralExpression(node)) return undefined;
  for (const p of node.properties) {
    if (ts.isPropertyAssignment(p) && p.name.getText() === key) return p.initializer;
  }
  return undefined;
}

function check(
  method: string,
  args: readonly ts.Expression[],
  dom: DomSnapshotData,
): SelectorStatus {
  const els = dom.elements;
  const any = (pred: (e: DomElement) => boolean) => els.some(pred);
  const first = literal(args[0]);
  const exact = option(args[1], "exact")?.kind === ts.SyntaxKind.TrueKeyword;
  if (first === null) return "unchecked";

  switch (method) {
    case "getByRole": {
      if (first instanceof RegExp) return "unchecked";
      const name = literal(option(args[1], "name"));
      const nameOk = (v: string | null) => name === null || matches(name, v, exact);
      const inAria =
        name !== null &&
        typeof name === "string" &&
        norm(dom.aria).includes(norm(`${first} "${name}`));
      return any((e) => e.role === first && nameOk(e.name)) || inAria ? "found" : "missing";
    }
    case "getByLabel":
      return any(
        (e) =>
          matches(first, e.label, exact) ||
          (e.tag !== "label" && matches(first, e.name, exact) && e.role !== null),
      )
        ? "found"
        : "missing";
    case "getByText":
      return any((e) => matches(first, e.text, exact)) ||
        (typeof first === "string" && norm(dom.aria).includes(norm(first)))
        ? "found"
        : "missing";
    case "getByPlaceholder":
      return any((e) => matches(first, e.placeholder, exact)) ? "found" : "missing";
    case "getByTestId":
      return any((e) => (first instanceof RegExp ? first.test(e.testId ?? "") : e.testId === first))
        ? "found"
        : "missing";
    case "getByTitle":
    case "getByAltText":
      return any((e) => matches(first, e.name, exact)) ? "found" : "missing";
    default:
      return "unchecked"; // CSS / XPath locators cannot be verified reliably from a snapshot.
  }
}

/**
 * Lists every locator the script uses and whether it exists on the captured start page.
 * "missing" can be legitimate for elements on later pages, so it is a warning, not a blocker.
 */
export function selectorCheck(code: string, dom: DomSnapshotData | null): SelectorResult[] {
  const source = ts.createSourceFile(
    "script.spec.ts",
    code,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  const out: SelectorResult[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      LOCATOR_METHODS.has(node.expression.name.text)
    ) {
      const method = node.expression.name.text;
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      const text = `${method}(${node.arguments.map((a) => a.getText(source)).join(", ")})`.slice(
        0,
        300,
      );
      const status = dom ? check(method, node.arguments, dom) : "unchecked";
      out.push({
        line: line + 1,
        selector: text,
        status,
        note:
          status === "missing"
            ? "Not on the captured start page — fine if it appears after navigating."
            : status === "unchecked"
              ? method === "locator"
                ? "CSS/XPath locators can't be checked; prefer role, label or test id."
                : "Dynamic value — can't be checked."
              : null,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out.slice(0, 200);
}
