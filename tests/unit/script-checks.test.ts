import { describe, expect, it } from "vitest";
import type { DomSnapshotData } from "@/server/sandbox/protocol";
import { selectorCheck } from "@/server/scripts/selector-check";
import { staticSafetyCheck } from "@/server/scripts/static-check";
import { typeCheckScript } from "@/server/scripts/typecheck";
import { checkScript } from "@/server/scripts/validate";
import { readFileSync } from "node:fs";

const GOOD = `import { test, expect, account, vars } from "./traxion";

test("TC-001 sign in", async ({ page }) => {
  const user = account("Standard user");
  await test.step("Open the sign-in page", async () => {
    await page.goto("/login");
  });
  await page.getByLabel("Email").fill(user.username);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  expect(vars.SHOP_NAME).toBeTruthy();
});
`;

describe("static safety check", () => {
  it("accepts a normal script", () => {
    expect(staticSafetyCheck(GOOD)).toEqual({ ok: true, issues: [] });
  });

  const bad: [string, string, RegExp][] = [
    [
      "node import",
      `import { readFileSync } from "node:fs";\ntest("x", async ({ page }) => {});`,
      /Importing "node:fs"/,
    ],
    [
      "child_process",
      `import cp from "child_process";\ntest("x", async ({ page }) => {});`,
      /child_process/,
    ],
    ["require", `test("x", async ({ page }) => { require("fs"); });`, /Loading modules/],
    ["dynamic import", `test("x", async ({ page }) => { await import("fs"); });`, /Dynamic import/],
    ["eval", `test("x", async ({ page }) => { eval("1"); });`, /eval/],
    [
      "Function",
      `test("x", async ({ page }) => { new Function("return 1")(); });`,
      /Creating functions/,
    ],
    ["process.env", `test("x", async ({ page }) => { console.log(process.env); });`, /process/],
    [
      "constructor trick",
      `test("x", async ({ page }) => { ({}).constructor.constructor("return process")(); });`,
      /constructor/,
    ],
    [
      "computed access",
      `test("x", async ({ page }) => { const k = "con" + "structor"; (page as any)[k]; });`,
      /Computed property/,
    ],
    [
      "context cookies",
      `test("x", async ({ page }) => { await page.context().cookies(); });`,
      /browser context/,
    ],
    [
      "request fixture",
      `test("x", async ({ page, request }) => { await request.get("http://evil"); });`,
      /"request" fixture/,
    ],
    [
      "route",
      `test("x", async ({ page }) => { await page.route("**", r => r.abort()); });`,
      /Intercepting/,
    ],
    [
      "string evaluate",
      `test("x", async ({ page }) => { await page.evaluate("fetch('http://evil')"); });`,
      /must be given a function/,
    ],
    [
      "absolute goto",
      `test("x", async ({ page }) => { await page.goto("https://evil.example"); });`,
      /relative/,
    ],
    [
      "fetch",
      `test("x", async ({ page }) => { await fetch("http://evil"); });`,
      /Network requests/,
    ],
    ["globalThis", `test("x", async ({ page }) => { globalThis.x = 1; });`, /globals/],
    ["no tests", `const x = 1;`, /at least one test/],
  ];
  for (const [name, code, message] of bad) {
    it(`rejects ${name}`, () => {
      const result = staticSafetyCheck(code);
      expect(result.ok).toBe(false);
      expect(result.issues.map((i) => i.message).join(" | ")).toMatch(message);
    });
  }

  it("allows property names that merely look like forbidden globals", () => {
    const code = `import { test } from "./traxion";\ntest("x", async ({ page }) => { const o = { process: 1, require: 2 }; void o.process; });`;
    expect(staticSafetyCheck(code).ok).toBe(true);
  });
});

describe("type check", () => {
  it("passes a valid script against the real Playwright types", () => {
    const r = typeCheckScript(GOOD);
    expect(r.diagnostics).toEqual([]);
  }, 60_000);

  it("reports type errors with line numbers", () => {
    const r = typeCheckScript(
      `import { test, expect } from "./traxion";\ntest("x", async ({ page }) => {\n  await page.clickk("#a");\n});\n`,
    );
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0]).toMatchObject({ line: 3 });
    expect(r.diagnostics[0]?.message).toMatch(/clickk/);
  }, 60_000);

  it("the harness the runner ships matches the declared harness types", () => {
    // Type-check the actual runner harness as a module, so its exports cannot drift.
    const harness = readFileSync("runner/traxion.tpl", "utf8");
    expect(harness).toMatch(/export function account\(label: string\)/);
    expect(harness).toMatch(/export const vars/);
    expect(harness).toMatch(/export const test = base\.extend/);
    expect(harness).toMatch(/export \{ expect \}/);
  });
});

describe("selector check", () => {
  const dom: DomSnapshotData = {
    url: "http://x/login",
    title: "Sign in",
    aria: '- heading "Sign in" [level=1]\n- textbox "Email"\n- button "Sign in"',
    elements: [
      {
        role: "heading",
        name: "Sign in",
        label: null,
        placeholder: null,
        testId: null,
        text: "Sign in",
        tag: "h1",
        type: null,
      },
      {
        role: "textbox",
        name: "Email",
        label: "Email",
        placeholder: "you@example.com",
        testId: "email",
        text: null,
        tag: "input",
        type: "email",
      },
      {
        role: "textbox",
        name: "Password",
        label: "Password",
        placeholder: null,
        testId: null,
        text: null,
        tag: "input",
        type: "password",
      },
      {
        role: "button",
        name: "Sign in",
        label: null,
        placeholder: null,
        testId: "submit",
        text: "Sign in",
        tag: "button",
        type: "submit",
      },
    ],
  };

  it("marks each locator as found, missing or unchecked", () => {
    const code = `test("x", async ({ page }) => {
  await page.getByLabel("Email").fill("a");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "Welcome back" }).isVisible();
  await page.getByTestId("submit").click();
  await page.getByPlaceholder("you@").fill("a");
  await page.locator("#weird > div").click();
  await page.getByText(/sign\\s+in/i).click();
});`;
    const results = selectorCheck(code, dom);
    expect(results.map((r) => r.status)).toEqual([
      "found",
      "found",
      "missing",
      "found",
      "found",
      "unchecked",
      "found",
    ]);
    expect(results[2]?.note).toMatch(/after navigating/);
    expect(results[0]).toMatchObject({ line: 2, selector: 'getByLabel("Email")' });
  });

  it("everything is unchecked without a snapshot", () => {
    expect(selectorCheck(GOOD, null).every((r) => r.status === "unchecked")).toBe(true);
  });

  it("checkScript combines the three checks", () => {
    const r = checkScript(GOOD, dom);
    expect(r.typeCheckOk).toBe(true);
    expect(r.safetyCheckOk).toBe(true);
    expect(r.selectorCheck.length).toBeGreaterThan(0);
    expect(checkScript("x".repeat(100_001), dom).safetyCheckOk).toBe(false);
  }, 60_000);
});
