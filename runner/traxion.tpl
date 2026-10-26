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

/** Blocks before each user action while the run is paused; paused time does not count. */
async function gate(testInfo: TestInfo): Promise<void> {
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

export const test = base.extend<{ _traxionScreencast: void }>({
  page: async ({ page }, use, testInfo) => {
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
