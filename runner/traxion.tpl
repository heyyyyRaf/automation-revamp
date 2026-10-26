// Traxion QA test harness — written into every run folder. Generated scripts import from here:
//   import { test, expect, account, vars } from "./traxion";
// It provides test accounts and variables (never placed in AI prompts), a live screencast,
// and the pause gate used by the Live Run view.
import { test as base, expect, type TestInfo } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = process.env.TQA_DIR ?? ".";
const secrets = JSON.parse(readFileSync(join(DIR, "secrets.json"), "utf8")) as {
  accounts: Record<string, { username: string; password: string }>;
  vars: Record<string, string>;
};

/** A test account configured on the environment, by its label (e.g. "Standard user"). */
export function account(label: string): { username: string; password: string } {
  const found = secrets.accounts[label];
  if (!found) throw new Error(`No test account named "${label}" in this environment.`);
  return found;
}

/** Non-secret environment variables. */
export const vars: Readonly<Record<string, string>> = Object.freeze({ ...secrets.vars });

const CONTROL = join(DIR, "control");
/** Design "Slow motion": milliseconds to wait before each action (0 = normal speed). */
const SPEED = join(DIR, "speed");
const ACTIONS = new Set([
  "goto", "reload", "goBack", "goForward", "click", "dblclick", "tap", "fill", "type",
  "press", "pressSequentially", "check", "uncheck", "setChecked", "selectOption", "hover",
  "focus", "setInputFiles", "dragTo", "dragAndDrop", "clear", "selectText", "waitForURL",
]);

function paused(): boolean {
  try {
    return existsSync(CONTROL) && readFileSync(CONTROL, "utf8").trim() === "pause";
  } catch {
    return false;
  }
}

function slowMoMs(): number {
  try {
    const ms = existsSync(SPEED) ? Number(readFileSync(SPEED, "utf8").trim()) : 0;
    return Number.isFinite(ms) ? Math.min(Math.max(ms, 0), 2000) : 0;
  } catch {
    return 0;
  }
}

/**
 * Before each user action: waits while the run is paused, and slows down when slow motion
 * is on. Neither counts toward the test's timeout.
 */
async function gate(testInfo: TestInfo): Promise<void> {
  const slow = slowMoMs();
  if (slow > 0) {
    await new Promise((r) => setTimeout(r, slow));
    testInfo.setTimeout(testInfo.timeout + slow);
  }
  if (!paused()) return;
  const started = Date.now();
  while (paused()) await new Promise((r) => setTimeout(r, 250));
  testInfo.setTimeout(testInfo.timeout + (Date.now() - started));
}

function wrap<T extends object>(target: T, testInfo: TestInfo): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      const value = Reflect.get(obj, prop, receiver) as unknown;
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        if (typeof prop === "string" && ACTIONS.has(prop)) {
          return gate(testInfo).then(() => (value as (...a: unknown[]) => unknown).apply(obj, args));
        }
        const result = (value as (...a: unknown[]) => unknown).apply(obj, args);
        // Locators / frame locators are returned synchronously: wrap them too.
        if (result && typeof result === "object" && !(result instanceof Promise)) {
          return wrap(result as object, testInfo);
        }
        return result;
      };
    },
  });
}

const CONSOLE_LEVELS: Record<string, string> = {
  log: "log",
  info: "info",
  warning: "warning",
  error: "error",
  debug: "debug",
};
const NET_TYPES = new Set(["document", "xhr", "fetch"]);
let consoleCount = 0;
let netCount = 0;

function line(prefix: string, payload: Record<string, unknown>): void {
  process.stdout.write(`${prefix}${JSON.stringify(payload)}\n`);
}

export const test = base.extend<{ _traxionScreencast: void }>({
  page: async ({ page, baseURL }, use, testInfo) => {
    // Browser console (FR-8.3) and same-origin page/API requests (Network tab). Only the
    // path is kept — never query strings or bodies, which may carry typed values.
    const origin = baseURL ? new URL(baseURL).origin : null;
    page.on("console", (msg) => {
      if (consoleCount++ > 500) return;
      line("__TQA_CONSOLE__", {
        level: CONSOLE_LEVELS[msg.type()] ?? "log",
        text: msg.text().slice(0, 2000),
      });
    });
    const record = (req: import("@playwright/test").Request, failed: boolean) => {
      if (!NET_TYPES.has(req.resourceType()) || netCount++ > 500) return;
      let url: URL;
      try {
        url = new URL(req.url());
      } catch {
        return;
      }
      if (origin && url.origin !== origin) return;
      const timing = req.timing();
      void (failed ? Promise.resolve(null) : req.response())
        .then((res) =>
          line("__TQA_NET__", {
            method: req.method(),
            url: url.pathname.slice(0, 1000),
            status: res ? res.status() : null,
            durationMs: timing.responseEnd > 0 ? Math.round(timing.responseEnd) : null,
            failed,
          }),
        )
        .catch(() => undefined);
    };
    page.on("requestfinished", (req) => record(req, false));
    page.on("requestfailed", (req) => record(req, true));
    await use(wrap(page, testInfo));
  },
  _traxionScreencast: [
    async ({ page }, use) => {
      let busy = false;
      const timer = setInterval(() => {
        if (busy) return;
        busy = true;
        page
          .screenshot({ type: "jpeg", quality: 45, scale: "css", timeout: 2000 })
          .then((buf) => process.stdout.write(`__TQA_FRAME__${buf.toString("base64")}\n`))
          .catch(() => undefined)
          .finally(() => {
            busy = false;
          });
      }, 700);
      await use();
      clearInterval(timer);
    },
    { auto: true },
  ],
});

export { expect };
