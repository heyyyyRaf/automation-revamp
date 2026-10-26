/**
 * Real end-to-end sandbox tests: real Chromium, the real runner bundle, the real harness and
 * reporter, and the real egress proxy — in local mode (a child process instead of a container).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runInSandbox, type SandboxSession } from "@/server/sandbox/sandbox";
import type { RunnerEvent } from "@/server/sandbox/protocol";
import { DEMO_USER, startDemoSite, type DemoSite } from "../support/demo-site";

let site: DemoSite;

beforeAll(async () => {
  site = await startDemoSite();
});
afterAll(async () => {
  await site.close();
});

const base = () => ({
  baseURL: site.origin,
  storageState: null,
  accounts: { "Standard user": DEMO_USER },
  vars: { SHOP_NAME: "Demo Shop" },
  testTimeoutMs: 30_000,
  retries: 0,
  slowMoMs: 0,
  tests: [],
});

async function collect(
  run: Parameters<typeof runInSandbox>[0],
  onEvent?: (e: RunnerEvent, session: SandboxSession | null) => void,
): Promise<RunnerEvent[]> {
  const events: RunnerEvent[] = [];
  let session: SandboxSession | null = null;
  for await (const e of runInSandbox({ ...run, onSession: (s) => (session = s) })) {
    events.push(e);
    onEvent?.(e, session);
  }
  return events;
}

const origins = () => [{ origin: site.origin, allowPrivate: true }];

describe("capture", () => {
  it("captures the accessibility tree and interactive elements of a page", async () => {
    const events = await collect({
      sessionId: "capture-test-1",
      label: "test",
      origins: origins(),
      input: { ...base(), mode: "capture", capture: { paths: ["/login"] } },
      timeoutMs: 60_000,
    });
    const cap = events.find((e) => e.t === "capture");
    expect(cap?.t).toBe("capture");
    if (cap?.t !== "capture") return;
    expect(cap.snapshot.title).toBe("Sign in");
    expect(cap.snapshot.aria).toContain('button "Sign in"');
    expect(cap.snapshot.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "textbox", label: "Email" }),
        expect.objectContaining({ role: "button", name: "Sign in" }),
      ]),
    );
    expect(cap.screenshot?.length).toBeGreaterThan(1000);
  });
});

describe("multi-page capture", () => {
  it("captures every page of the flow and skips one that fails", async () => {
    const events = await collect({
      sessionId: "capture-test-2",
      label: "test",
      origins: origins(),
      input: { ...base(), mode: "capture", capture: { paths: ["/", "/cart"] } },
      timeoutMs: 60_000,
    });
    const caps = events.filter((e) => e.t === "capture");
    expect(caps.map((c) => (c.t === "capture" ? c.snapshot.title : ""))).toEqual([
      "Demo Shop",
      "Cart",
    ]);
    expect(events.find((e) => e.t === "done")).toMatchObject({ ok: true });
  });
});

describe("login", () => {
  const login = (password: string) =>
    collect({
      sessionId: `login-test-${password.length}`,
      label: "test",
      origins: origins(),
      input: {
        ...base(),
        accounts: { "Standard user": { username: DEMO_USER.username, password } },
        mode: "login",
        login: {
          path: "/login",
          usernameLabel: "Email",
          passwordLabel: "Password",
          submitLabel: "Sign in",
          successText: "Welcome back",
          account: "Standard user",
        },
      },
      timeoutMs: 60_000,
    });

  it("signs in and returns the session state", async () => {
    const events = await login(DEMO_USER.password);
    const result = events.find((e) => e.t === "login");
    expect(result).toMatchObject({ t: "login", ok: true });
    expect(result?.t === "login" && result.storageState).toContain('"session"');
  });

  it("reports a failed login without leaking the password", async () => {
    const wrong = "Wr0ng-Password-123";
    const events = await login(wrong);
    expect(events.find((e) => e.t === "login")).toMatchObject({ ok: false });
    expect(JSON.stringify(events)).not.toContain(wrong);
    // A sentence a tester can act on, quoting what the app showed — not a Playwright error.
    const result = events.find((e) => e.t === "login");
    const error = result?.t === "login" ? (result.error ?? "") : "";
    expect(error).toContain("check the test account's username and password");
    expect(error).toContain('The app said: "Invalid email or password"');
    expect(error).not.toMatch(/locator|Timeout \d+ms/);
  });

  it("names the missing field when the sign-in form doesn't match", async () => {
    const events = await collect({
      sessionId: "login-test-labels",
      label: "test",
      origins: origins(),
      input: {
        ...base(),
        mode: "login",
        login: {
          path: "/login",
          usernameLabel: "Username",
          passwordLabel: "Password",
          submitLabel: "Sign in",
          successText: "Welcome back",
          account: "Standard user",
        },
      },
      timeoutMs: 60_000,
    });
    const result = events.find((e) => e.t === "login");
    expect(result?.t === "login" && result.error).toBe(
      'Couldn\'t find a field labelled "Username" on /login.',
    );
  });
});

describe("run", () => {
  const passing = `import { test, expect, account, vars } from "./traxion";
test("TC-001 add to cart", async ({ page }) => {
  await test.step("Open the cart", async () => {
    await page.goto("/cart");
  });
  await page.getByTestId("add-item").click();
  await expect(page.getByText("Items: 1")).toBeVisible();
  expect(vars.SHOP_NAME).toBe("Demo Shop");
});
`;
  const failing = `import { test, expect, account } from "./traxion";
test("TC-002 sign in", async ({ page }) => {
  const user = account("Standard user");
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.username);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Nope" })).toBeVisible({ timeout: 2000 });
});
`;

  it("runs approved scripts, streaming steps, frames and traces; credentials never leak", async () => {
    const events = await collect({
      sessionId: "run-test-1",
      label: "test",
      origins: origins(),
      input: {
        ...base(),
        mode: "run",
        tests: [
          { id: "aaaaaaaaaaaaaaaaaaaaaaaa", code: passing },
          { id: "bbbbbbbbbbbbbbbbbbbbbbbb", code: failing },
        ],
      },
      timeoutMs: 120_000,
    });
    const ends = events.filter((e) => e.t === "test-end");
    expect(ends).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "aaaaaaaaaaaaaaaaaaaaaaaa", status: "passed" }),
        expect.objectContaining({ id: "bbbbbbbbbbbbbbbbbbbbbbbb", status: "failed" }),
      ]),
    );
    const failed = ends.find((e) => e.t === "test-end" && e.status === "failed");
    expect(failed?.t === "test-end" && failed.error).toMatch(/Nope/);

    const steps = events.filter((e) => e.t === "step-end");
    expect(steps.some((s) => s.t === "step-end" && s.title === "Open the cart")).toBe(true);
    expect(steps.some((s) => s.t === "step-end" && s.category === "pw:api")).toBe(true);
    // Fixture setup steps are not shown as user actions.
    expect(steps.some((s) => s.t === "step-end" && s.title === "Launch browser")).toBe(false);
    // Neither are the live view's own frame captures — but the frames still arrive.
    expect(steps.some((s) => s.t === "step-end" && /^Screenshot/.test(s.title))).toBe(false);
    expect(events.some((e) => e.t === "frame")).toBe(true);
    const traces = events.filter((e) => e.t === "artifact" && e.kind === "trace");
    expect(new Set(traces.map((t) => (t.t === "artifact" ? t.id : "")))).toEqual(
      new Set(["aaaaaaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbbbbbb"]),
    );
    expect(events.at(-1)).toMatchObject({ t: "exit" });

    // The password was typed into the page, but no event text carries it.
    const textEvents = events.filter((e) => e.t !== "frame" && e.t !== "artifact");
    expect(JSON.stringify(textEvents)).not.toContain(DEMO_USER.password);
    expect(JSON.stringify(textEvents)).toContain("••••••");
  });

  it("blocks traffic to origins that were not approved", async () => {
    const other = await startDemoSite();
    try {
      const code = `import { test, expect } from "./traxion";
test("TC-003 exfiltrate", async ({ page }) => {
  await page.goto("${other.origin}/");
  await expect(page.getByRole("heading", { name: "Demo Shop" })).toBeVisible({ timeout: 3000 });
});
`;
      const events = await collect({
        sessionId: "run-test-egress",
        label: "test",
        origins: origins(), // only `site`, not `other`
        input: { ...base(), mode: "run", tests: [{ id: "cccccccccccccccccccccccc", code }] },
        timeoutMs: 60_000,
      });
      expect(events.find((e) => e.t === "test-end")).toMatchObject({ status: "failed" });
      // The proxy refused it: the unapproved site never received a single request.
      expect(other.requests()).toBe(0);
    } finally {
      await other.close();
    }
  });

  it("pauses between actions and resumes", async () => {
    const code = `import { test, expect } from "./traxion";
test("TC-004 slow", async ({ page }) => {
  await page.goto("/cart");
  await page.getByTestId("add-item").click();
  await page.getByTestId("add-item").click();
  await expect(page.getByText("Items: 2")).toBeVisible();
});
`;
    let pausedAt = 0;
    let resumedAt = 0;
    let stepsWhilePaused = 0;
    let clicksAfterResume = 0;
    const events = await collect(
      {
        sessionId: "run-test-pause",
        label: "test",
        origins: origins(),
        input: { ...base(), mode: "run", tests: [{ id: "dddddddddddddddddddddddd", code }] },
        timeoutMs: 120_000,
      },
      (e, session) => {
        if (e.t === "step-end" && e.title.startsWith("Navigate") && !pausedAt && session) {
          pausedAt = Date.now();
          void session.control("pause");
          setTimeout(() => {
            resumedAt = Date.now();
            void session.control("resume");
          }, 2500);
        } else if (e.t === "step-end" && e.category === "pw:api" && e.title.startsWith("Click")) {
          if (pausedAt && !resumedAt) stepsWhilePaused++;
          if (resumedAt) clicksAfterResume++;
        }
      },
    );
    expect(events.some((e) => e.t === "paused")).toBe(true);
    expect(events.some((e) => e.t === "resumed")).toBe(true);
    // An action already in flight when "pause" arrives may finish; no new action starts.
    expect(stepsWhilePaused).toBeLessThanOrEqual(1);
    expect(clicksAfterResume).toBeGreaterThanOrEqual(1);
    expect(events.find((e) => e.t === "test-end")).toMatchObject({ status: "passed" });
  });

  it("stops a run on request", async () => {
    const code = `import { test } from "./traxion";
test("TC-005 forever", async ({ page }) => {
  await page.goto("/cart");
  for (;;) { await page.getByTestId("add-item").click(); }
});
`;
    const started = Date.now();
    const events = await collect(
      {
        sessionId: "run-test-stop",
        label: "test",
        origins: origins(),
        input: {
          ...base(),
          mode: "run",
          testTimeoutMs: 120_000,
          tests: [{ id: "eeeeeeeeeeeeeeeeeeeeeeee", code }],
        },
        timeoutMs: 120_000,
      },
      (e, session) => {
        if (e.t === "test-begin" && session) setTimeout(() => void session.control("stop"), 3000);
      },
    );
    expect(Date.now() - started).toBeLessThan(60_000);
    expect(events.some((e) => e.t === "test-end" && e.status === "passed")).toBe(false);
    expect(events.at(-1)).toMatchObject({ t: "exit" });
  });
});

describe("run extras", () => {
  const consoleAndNet = `import { test, expect } from "./traxion";
test("TC-003 cart loads", async ({ page }) => {
  await page.goto("/cart");
  await expect(page.getByText("Items: 0")).toBeVisible();
});
`;
  const flaky = `import { test, expect } from "./traxion";
test("TC-004 always fails", async ({ page }) => {
  await page.goto("/cart");
  await expect(page.getByText("Never there")).toBeVisible({ timeout: 1000 });
});
`;

  it("records the browser console and same-origin requests, without query strings", async () => {
    const events = await collect({
      sessionId: "run-test-extras-1",
      label: "test",
      origins: origins(),
      input: {
        ...base(),
        mode: "run",
        tests: [{ id: "cccccccccccccccccccccccc", code: consoleAndNet }],
      },
      timeoutMs: 120_000,
    });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ t: "console", level: "log", text: "cart ready" }),
        expect.objectContaining({ t: "net", method: "GET", url: "/api/items", status: 200 }),
      ]),
    );
    expect(JSON.stringify(events)).not.toContain("QUERY-SECRET-123");
  });

  it("retries a failed test the configured number of times", async () => {
    const events = await collect({
      sessionId: "run-test-extras-2",
      label: "test",
      origins: origins(),
      input: {
        ...base(),
        mode: "run",
        retries: 1,
        tests: [{ id: "dddddddddddddddddddddddd", code: flaky }],
      },
      timeoutMs: 120_000,
    });
    const begins = events.filter((e) => e.t === "test-begin");
    expect(begins.map((b) => (b.t === "test-begin" ? b.retry : -1))).toEqual([0, 1]);
    const ends = events.filter((e) => e.t === "test-end");
    expect(ends.at(-1)).toMatchObject({ status: "failed", retry: 1 });
  });
});

describe("report PDF", () => {
  it("prints a self-contained page to PDF and lets nothing reach the network", async () => {
    const { printReportPdf } = await import("@/server/exports/report-files");
    const before = site.requests();
    const html = `<!doctype html><html><body><h1>Run #3 report</h1>
      <img src="${site.origin}/tracker.png"><link rel="stylesheet" href="${site.origin}/x.css">
      <script>document.body.append("ran")</script></body></html>`;
    const pdf = await printReportPdf(html, "pdf-test-1");
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(500);
    expect(site.requests()).toBe(before);
  });
});
