import ts from "typescript";

/**
 * Static safety check for generated / edited Playwright scripts, run before a script version is
 * saved and again right before execution. Scripts are AI- or user-written code, so they may only
 * use the browser through `page`, the harness (`./traxion`) and `@playwright/test` — no Node APIs,
 * no dynamic code, no reflection tricks. The sandbox is the second line of defence.
 */
export interface SafetyIssue {
  line: number;
  message: string;
}

const ALLOWED_IMPORTS = new Set(["@playwright/test", "./traxion"]);
const ALLOWED_FIXTURES = new Set(["page"]);

const FORBIDDEN_IDENTIFIERS = new Map<string, string>([
  ["require", "Loading modules is not allowed."],
  ["process", "Access to the Node.js process is not allowed."],
  ["eval", "eval() is not allowed."],
  ["Function", "Creating functions from strings is not allowed."],
  ["globalThis", "Access to globals is not allowed."],
  ["global", "Access to globals is not allowed."],
  ["module", "Access to the module system is not allowed."],
  ["exports", "Access to the module system is not allowed."],
  ["__dirname", "File-system paths are not allowed."],
  ["__filename", "File-system paths are not allowed."],
  ["WebAssembly", "WebAssembly is not allowed."],
  ["fetch", "Network requests from the test itself are not allowed; drive the page instead."],
  ["XMLHttpRequest", "Network requests from the test itself are not allowed."],
  ["WebSocket", "Network connections from the test itself are not allowed."],
  ["Worker", "Workers are not allowed."],
  ["Buffer", "Binary buffers are not allowed."],
  ["setInterval", "Background timers are not allowed."],
]);

const FORBIDDEN_MEMBERS = new Map<string, string>([
  ["constructor", "Reflection through .constructor is not allowed."],
  ["__proto__", "Prototype access is not allowed."],
  ["prototype", "Prototype access is not allowed."],
  ["context", "Access to the browser context (cookies, storage) is not allowed."],
  ["browser", "Access to the browser object is not allowed."],
  ["request", "Direct HTTP requests are not allowed; drive the page instead."],
  ["route", "Intercepting network traffic is not allowed."],
  ["routeFromHAR", "Intercepting network traffic is not allowed."],
  ["unroute", "Intercepting network traffic is not allowed."],
  ["addInitScript", "Injecting scripts into pages is not allowed."],
  ["exposeFunction", "Exposing functions to pages is not allowed."],
  ["exposeBinding", "Exposing functions to pages is not allowed."],
  ["evaluateHandle", "evaluateHandle is not allowed."],
  ["setExtraHTTPHeaders", "Changing request headers is not allowed."],
  ["storageState", "Reading the session state is not allowed."],
  ["addCookies", "Changing cookies is not allowed."],
  ["cookies", "Reading cookies is not allowed."],
  ["waitForTimeout", "Fixed waits make tests flaky; wait for something visible instead."],
]);

const TEST_FUNCTIONS = new Set([
  "test",
  "beforeEach",
  "afterEach",
  "beforeAll",
  "afterAll",
  "step",
]);

export function staticSafetyCheck(code: string): { ok: boolean; issues: SafetyIssue[] } {
  const source = ts.createSourceFile(
    "script.spec.ts",
    code,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  const issues: SafetyIssue[] = [];
  let testCalls = 0;
  const report = (node: ts.Node, message: string) => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    issues.push({ line: line + 1, message });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const spec = ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : "";
      if (!ALLOWED_IMPORTS.has(spec))
        report(node, `Importing "${spec}" is not allowed. Use "./traxion" or "@playwright/test".`);
    } else if (ts.isImportEqualsDeclaration(node) || ts.isExportAssignment(node)) {
      report(node, "This kind of import/export is not allowed.");
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      report(node, "Dynamic import() is not allowed.");
    } else if (
      ts.isIdentifier(node) &&
      FORBIDDEN_IDENTIFIERS.has(node.text) &&
      !isPropertyName(node)
    ) {
      report(node, FORBIDDEN_IDENTIFIERS.get(node.text) ?? "Not allowed.");
    } else if (ts.isPropertyAccessExpression(node) && FORBIDDEN_MEMBERS.has(node.name.text)) {
      report(node.name, FORBIDDEN_MEMBERS.get(node.name.text) ?? "Not allowed.");
    } else if (ts.isElementAccessExpression(node)) {
      const arg = node.argumentExpression;
      if (
        !ts.isNumericLiteral(arg) &&
        !(ts.isStringLiteral(arg) && !FORBIDDEN_MEMBERS.has(arg.text))
      ) {
        report(node, "Computed property access is not allowed; use a plain property name.");
      }
    } else if (ts.isCallExpression(node)) {
      checkCall(node);
    } else if (
      node.kind === ts.SyntaxKind.WithStatement ||
      node.kind === ts.SyntaxKind.DebuggerStatement
    ) {
      report(node, "This statement is not allowed.");
    }
    ts.forEachChild(node, visit);
  };

  const checkCall = (call: ts.CallExpression) => {
    const callee = call.expression;
    const name = ts.isIdentifier(callee)
      ? callee.text
      : ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : "";
    const isTestFn =
      (ts.isIdentifier(callee) && callee.text === "test") ||
      (ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === "test" &&
        TEST_FUNCTIONS.has(callee.name.text));
    if (ts.isIdentifier(callee) && callee.text === "test") testCalls++;
    if (isTestFn) {
      // Only the `page` fixture may be requested: ({ page }) => ...
      for (const arg of call.arguments) {
        if (!ts.isArrowFunction(arg) && !ts.isFunctionExpression(arg)) continue;
        const first = arg.parameters[0];
        if (!first) continue;
        if (!ts.isObjectBindingPattern(first.name)) {
          report(first, "Request fixtures by name, e.g. async ({ page }) => ...");
          continue;
        }
        for (const el of first.name.elements) {
          const fixture = (el.propertyName ?? el.name).getText(source);
          if (!ALLOWED_FIXTURES.has(fixture))
            report(el, `The "${fixture}" fixture is not allowed; use "page".`);
        }
      }
    }
    if (name === "evaluate" || name === "$eval" || name === "$$eval") {
      const first = call.arguments[0];
      if (first && !ts.isArrowFunction(first) && !ts.isFunctionExpression(first)) {
        report(call, "evaluate() must be given a function, not a string.");
      }
    }
    if (name === "goto") {
      const first = call.arguments[0];
      if (
        first &&
        (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first)) &&
        /^[a-z]+:/i.test(first.text)
      ) {
        report(call, 'Use a path relative to the environment, e.g. page.goto("/cart").');
      }
    }
  };

  visit(source);
  if (testCalls === 0)
    issues.push({ line: 1, message: "The script must contain at least one test(...)." });
  return { ok: issues.length === 0, issues };
}

/** `obj.process` / `{ process: 1 }` use the word as a property name, not the global. */
function isPropertyName(node: ts.Identifier): boolean {
  const p = node.parent;
  return (
    (ts.isPropertyAccessExpression(p) && p.name === node) ||
    (ts.isPropertyAssignment(p) && p.name === node) ||
    (ts.isBindingElement(p) && p.propertyName === node) ||
    ts.isPropertySignature(p) ||
    (ts.isMethodDeclaration(p) && p.name === node)
  );
}
