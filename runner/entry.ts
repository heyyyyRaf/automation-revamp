/**
 * Runner entry — executes inside the sandbox (a fresh container per run).
 * stdin:  one JSON line (RunnerInput), then control lines: pause | resume | stop
 * stdout: NDJSON RunnerEvents (secrets scrubbed)
 */
import { spawn, type ChildProcess } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "@playwright/test";
import {
  runnerInputSchema,
  scrub,
  secretVariants,
  type DomElement,
  type RunnerInput,
} from "../src/server/sandbox/protocol";
import harnessSource from "./traxion.tpl";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const MAX_ARTIFACT_BYTES = 30 * 1024 * 1024;
const CHUNK = 300_000;
/** Delay before each action in slow motion. */
const SLOW_MO_MS = 800;

let variants: string[] = [];
/** Base64 payloads and the session state are passed through untouched; all text is scrubbed. */
const RAW_KEYS = new Set(["jpeg", "data", "screenshot", "storageState"]);

function deepScrub(value: unknown, key = ""): unknown {
  if (typeof value === "string") return RAW_KEYS.has(key) ? value : scrub(value, variants);
  if (Array.isArray(value)) return value.map((v) => deepScrub(v));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deepScrub(v, k)]));
  }
  return value;
}

function emit(event: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(deepScrub(event))}\n`);
}

async function main(): Promise<void> {
  const rl = createInterface({ input: process.stdin });
  const lines = rl[Symbol.asyncIterator]();
  const first = await lines.next();
  const input = runnerInputSchema.parse(JSON.parse(String(first.value ?? "")));
  variants = secretVariants([
    ...Object.values(input.accounts).flatMap((a) => [a.password, a.username]),
    ...(input.proxy ? [input.proxy.password] : []),
  ]);

  const dir = mkdtempSync(join(tmpdir(), "tqa-run-"));
  emit({ t: "ready" });
  try {
    if (input.mode === "run") await runTests(input, dir, lines);
    else if (input.mode === "capture") await capture(input);
    else await login(input);
  } catch (err) {
    emit({
      t: "done",
      ok: false,
      error: err instanceof Error ? err.message.slice(0, 2000) : "Runner error",
    });
  } finally {
    rl.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function proxyOption(input: RunnerInput) {
  // "<-loopback>" makes Chromium send even localhost traffic through the egress proxy.
  return input.proxy ? { ...input.proxy, bypass: "<-loopback>" } : undefined;
}

// ── Run approved test scripts ──────────────────────────────────────────────

async function runTests(
  input: RunnerInput,
  dir: string,
  lines: AsyncIterator<string>,
): Promise<void> {
  mkdirSync(join(dir, "tests"));
  // Scripts import "./traxion", so the harness sits next to them.
  writeFileSync(join(dir, "tests", "traxion.ts"), harnessSource);
  writeFileSync(
    join(dir, "secrets.json"),
    JSON.stringify({ accounts: input.accounts, vars: input.vars }),
    {
      mode: 0o600,
    },
  );
  let storageState: string | undefined;
  if (input.storageState) {
    storageState = join(dir, "storage-state.json");
    writeFileSync(storageState, input.storageState, { mode: 0o600 });
  }
  for (const t of input.tests) writeFileSync(join(dir, "tests", `${t.id}.spec.ts`), t.code);
  if (input.slowMoMs > 0) writeFileSync(join(dir, "speed"), String(input.slowMoMs));

  // Scripts resolve "@playwright/test" from the runner's own installation.
  const pkg = require.resolve("@playwright/test/package.json");
  const nodeModules = pkg.slice(0, pkg.lastIndexOf("node_modules") + "node_modules".length);
  symlinkSync(nodeModules, join(dir, "node_modules"), "junction");

  const config = {
    testDir: "./tests",
    outputDir: "./test-results",
    timeout: input.testTimeoutMs,
    retries: input.retries,
    workers: 1,
    fullyParallel: false,
    reporter: [[join(HERE, "reporter.mjs")]],
    use: {
      baseURL: input.baseURL,
      headless: true,
      trace: "on",
      screenshot: "only-on-failure",
      video: "off",
      proxy: proxyOption(input),
      storageState,
      actionTimeout: 15_000,
      navigationTimeout: 30_000,
    },
    projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  };
  const configPath = join(dir, "playwright.config.mjs");
  writeFileSync(configPath, `export default ${JSON.stringify(config)};\n`);

  const child = spawn(
    process.execPath,
    [require.resolve("@playwright/test/cli"), "test", "--config", configPath],
    {
      cwd: dir,
      env: childEnv(dir),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const attachments: { id: string; kind: string; path: string }[] = [];
  const recentErrors: string[] = [];
  forwardOutput(child, attachments, recentErrors);
  void handleControl(lines, dir, child);

  const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
  for (const a of attachments) streamArtifact(a);
  const detail = recentErrors.length ? `: ${recentErrors.slice(-5).join(" | ")}` : "";
  emit({
    t: "done",
    ok: code === 0,
    error:
      code === 0 ? null : `Playwright exited with code ${String(code)}${detail}`.slice(0, 4000),
  });
}

function childEnv(dir: string): NodeJS.ProcessEnv {
  const keep = [
    "PATH",
    "Path",
    "HOME",
    "USERPROFILE",
    "TEMP",
    "TMP",
    "SystemRoot",
    "windir",
    "PLAYWRIGHT_BROWSERS_PATH",
  ];
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "production",
    TQA_DIR: dir,
    CI: "1",
    FORCE_COLOR: "0",
    PW_TEST_HTML_REPORT_OPEN: "never",
  };
  for (const k of keep) if (process.env[k]) env[k] = process.env[k];
  return env;
}

function forwardOutput(
  child: ChildProcess,
  attachments: { id: string; kind: string; path: string }[],
  recentErrors: string[],
): void {
  const remember = (text: string) => {
    recentErrors.push(text.slice(0, 500));
    if (recentErrors.length > 20) recentErrors.shift();
  };
  const out = createInterface({ input: child.stdout! });
  out.on("line", (line) => {
    let event: Record<string, unknown> | null = null;
    try {
      event = line.startsWith("{") ? (JSON.parse(line) as Record<string, unknown>) : null;
    } catch {
      event = null;
    }
    if (!event || typeof event["t"] !== "string") {
      if (line.trim()) emit({ t: "log", id: null, stream: "stdout", text: line.slice(0, 4000) });
      return;
    }
    if (event["t"] === "_attachments") {
      for (const f of (event["files"] as { kind: string; path: string }[] | undefined) ?? []) {
        attachments.push({ id: String(event["id"]), kind: f.kind, path: f.path });
      }
      return;
    }
    if (event["t"] === "_end") return;
    if (event["t"] === "log" && event["stream"] === "stderr") remember(String(event["text"]));
    emit(event);
  });
  const err = createInterface({ input: child.stderr! });
  err.on("line", (line) => {
    if (!line.trim()) return;
    remember(line);
    emit({ t: "log", id: null, stream: "stderr", text: line.slice(0, 4000) });
  });
}

async function handleControl(
  lines: AsyncIterator<string>,
  dir: string,
  child: ChildProcess,
): Promise<void> {
  for (;;) {
    const next = await lines.next();
    if (next.done) return;
    const cmd = String(next.value).trim();
    if (cmd === "pause" || cmd === "resume") {
      writeFileSync(join(dir, "control"), cmd);
      emit({ t: cmd === "pause" ? "paused" : "resumed" });
    } else if (cmd === "slow" || cmd === "normal") {
      writeFileSync(join(dir, "speed"), cmd === "slow" ? String(SLOW_MO_MS) : "0");
    } else if (cmd === "stop") {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
    }
  }
}

function streamArtifact(a: { id: string; kind: string; path: string }): void {
  try {
    if (statSync(a.path).size > MAX_ARTIFACT_BYTES) return;
    const b64 = readFileSync(a.path).toString("base64");
    const total = Math.max(1, Math.ceil(b64.length / CHUNK));
    for (let i = 0; i < total; i++) {
      emit({
        t: "artifact",
        id: a.id,
        kind: a.kind,
        seq: i,
        last: i === total - 1,
        data: b64.slice(i * CHUNK, (i + 1) * CHUNK),
      });
    }
  } catch {
    // Missing artifact: the test result still stands.
  }
}

// ── Capture a page for script generation ───────────────────────────────────

async function withPage<T>(
  input: RunnerInput,
  fn: (page: Page, browser: Browser) => Promise<T>,
): Promise<T> {
  const browser = await chromium.launch({ headless: true, proxy: proxyOption(input) });
  try {
    const context = await browser.newContext({
      baseURL: input.baseURL,
      ...(input.storageState
        ? { storageState: JSON.parse(input.storageState) as { cookies: never[]; origins: never[] } }
        : {}),
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    return await fn(page, browser);
  } finally {
    await browser.close();
  }
}

/** Captures each page of the flow (FRD step 4). A page that fails is skipped, not fatal. */
async function capture(input: RunnerInput): Promise<void> {
  const paths = input.capture?.paths ?? ["/"];
  let captured = 0;
  let lastError: string | null = null;
  await withPage(input, async (page) => {
    for (const path of paths) {
      try {
        await page.goto(path, { waitUntil: "domcontentloaded", timeout: 30_000 });
        await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
        const aria = (await page.ariaSnapshot({ timeout: 10_000 }).catch(() => "")).slice(
          0,
          80_000,
        );
        const elements = (await page.evaluate(collectElements)).slice(0, 600);
        const shot = await page.screenshot({ type: "jpeg", quality: 60 }).catch(() => null);
        emit({
          t: "capture",
          snapshot: {
            url: page.url().slice(0, 2000),
            title: (await page.title()).slice(0, 500),
            aria,
            elements,
          },
          screenshot: shot ? shot.toString("base64") : null,
        });
        captured++;
      } catch (err) {
        lastError = err instanceof Error ? (err.message.split("\n")[0] ?? "") : "Page failed";
      }
    }
  });
  emit({
    t: "done",
    ok: captured > 0,
    error: captured > 0 ? null : (lastError ?? "No page could be opened.").slice(0, 2000),
  });
}

/** Runs in the target page. Its output is untrusted and validated by the worker. */
function collectElements(): DomElement[] {
  const clip = (s: string | null | undefined, n = 300) => {
    const v = (s ?? "").replace(/\s+/g, " ").trim();
    return v ? v.slice(0, n) : null;
  };
  const implicitRole = (el: Element): string | null => {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") ?? "").toLowerCase();
    if (tag === "a" && el.hasAttribute("href")) return "link";
    if (tag === "button") return "button";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (/^h[1-6]$/.test(tag)) return "heading";
    if (tag === "img") return "img";
    if (tag === "input") {
      if (["button", "submit", "reset"].includes(type)) return "button";
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      return "textbox";
    }
    return null;
  };
  const labelFor = (el: Element): string | null => {
    const id = el.getAttribute("id");
    if (id) {
      const l = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (l) return clip(l.textContent);
    }
    const parent = el.closest("label");
    if (parent) return clip(parent.textContent);
    const by = el.getAttribute("aria-labelledby");
    if (by)
      return clip(
        by
          .split(/\s+/)
          .map((x) => document.getElementById(x)?.textContent ?? "")
          .join(" "),
      );
    return null;
  };
  const nodes = document.querySelectorAll(
    "a[href],button,input,select,textarea,[role],[data-testid],h1,h2,h3,h4,h5,h6,img[alt],label",
  );
  const out: DomElement[] = [];
  for (const el of Array.from(nodes)) {
    if (out.length >= 600) break;
    const rect = (el as HTMLElement).getBoundingClientRect?.();
    if (rect && rect.width === 0 && rect.height === 0 && el.tagName.toLowerCase() !== "input")
      continue;
    const label = labelFor(el);
    out.push({
      role: clip(el.getAttribute("role"), 40) ?? implicitRole(el),
      name:
        clip(el.getAttribute("aria-label")) ??
        label ??
        clip((el as HTMLElement).innerText) ??
        clip(el.getAttribute("title")) ??
        clip(el.getAttribute("alt")) ??
        clip(el.getAttribute("value")),
      label,
      placeholder: clip(el.getAttribute("placeholder")),
      testId: clip(el.getAttribute("data-testid"), 200),
      text: clip((el as HTMLElement).innerText),
      tag: el.tagName.toLowerCase().slice(0, 20),
      type: clip(el.getAttribute("type"), 30),
    });
  }
  return out;
}

// ── Verify login and save the session ──────────────────────────────────────

async function login(input: RunnerInput): Promise<void> {
  const cfg = input.login;
  if (!cfg) throw new Error("Missing login settings.");
  const acct = input.accounts[cfg.account];
  if (!acct) throw new Error("The selected test account is missing.");
  await withPage(input, async (page) => {
    let shot: string | null = null;
    try {
      await page.goto(cfg.path, { waitUntil: "domcontentloaded" });
      await page.getByLabel(cfg.usernameLabel, { exact: false }).first().fill(acct.username);
      await page.getByLabel(cfg.passwordLabel, { exact: false }).first().fill(acct.password);
      await page.getByRole("button", { name: cfg.submitLabel }).first().click();
      if (cfg.successUrlContains) {
        const part = cfg.successUrlContains;
        await page.waitForURL((u) => u.href.includes(part), { timeout: 20_000 });
      } else if (cfg.successText) {
        await page.getByText(cfg.successText).first().waitFor({ timeout: 20_000 });
      } else {
        await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
        if (
          await page
            .getByLabel(cfg.passwordLabel)
            .first()
            .isVisible()
            .catch(() => false)
        ) {
          throw new Error("The login form is still shown after signing in.");
        }
      }
      const state = JSON.stringify(await page.context().storageState());
      emit({ t: "login", ok: true, storageState: state, error: null, screenshot: null });
      emit({ t: "done", ok: true, error: null });
    } catch (err) {
      shot = await page
        .screenshot({ type: "jpeg", quality: 60 })
        .then((b) => b.toString("base64"))
        .catch(() => null);
      const message =
        err instanceof Error ? (err.message.split("\n")[0] ?? "Login failed") : "Login failed";
      emit({
        t: "login",
        ok: false,
        storageState: null,
        error: message.slice(0, 2000),
        screenshot: shot,
      });
      emit({ t: "done", ok: false, error: message.slice(0, 2000) });
    }
  });
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    emit({
      t: "done",
      ok: false,
      error: err instanceof Error ? err.message.slice(0, 2000) : "Runner error",
    });
    process.exit(1);
  },
);
