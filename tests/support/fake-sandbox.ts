/** Scripted stand-in for the browser sandbox, so jobs can be tested without Docker. */
import type { RunnerEvent, RunnerInput } from "@/server/sandbox/protocol";
import type { ControlCommand, Sandbox, SandboxSession } from "@/server/sandbox/sandbox";

const PNG = Buffer.from("fake-png").toString("base64");
const JPEG = Buffer.from("fake-jpeg").toString("base64");

export const CAPTURED_ELEMENTS = [
  {
    role: "textbox",
    name: "Email",
    label: "Email",
    placeholder: null,
    testId: null,
    text: null,
    tag: "input",
    type: "email",
  },
  {
    role: "button",
    name: "Sign in",
    label: null,
    placeholder: null,
    testId: null,
    text: "Sign in",
    tag: "button",
    type: "submit",
  },
];

export class FakeSandbox implements Sandbox {
  readonly inputs: RunnerInput[] = [];
  readonly controls: ControlCommand[] = [];
  loginOk = true;
  /** Capture fails (page not reachable). */
  captureFails = false;
  /** PDF printing fails. */
  pdfFails = false;
  /** Throw after this many tests (simulates a crashed container). */
  crashAfter: number | null = null;
  /** Decide each test's outcome per attempt from its code. */
  outcome: (code: string, retry: number) => "passed" | "failed" | "timedOut" = (code) =>
    code.includes("WILL_FAIL") ? "failed" : code.includes("WILL_TIME_OUT") ? "timedOut" : "passed";
  /** Called before each test starts (tests use it to send controls mid-run). */
  beforeTest: (() => Promise<void>) | null = null;

  async start(_sessionId: string, input: RunnerInput): Promise<SandboxSession> {
    this.inputs.push(input);
    // Settings are fixed per session (sessions run in parallel).
    const { crashAfter, loginOk, captureFails, pdfFails, outcome, beforeTest } = this;
    let stopped = false;
    async function* events(): AsyncIterable<RunnerEvent> {
      yield { t: "ready" };
      if (input.mode === "login") {
        yield loginOk
          ? {
              t: "login",
              ok: true,
              storageState: '{"cookies":[{"name":"session","value":"ok"}],"origins":[]}',
              error: null,
              screenshot: null,
            }
          : {
              t: "login",
              ok: false,
              storageState: null,
              error: "The login form is still shown after signing in.",
              screenshot: null,
            };
        yield { t: "done", ok: loginOk, error: loginOk ? null : "Login failed" };
        return;
      }
      if (input.mode === "capture") {
        if (captureFails) {
          yield { t: "done", ok: false, error: "net::ERR_CONNECTION_REFUSED" };
          return;
        }
        for (const path of input.capture?.paths ?? ["/"]) {
          yield {
            t: "capture",
            snapshot: {
              url: `${input.baseURL}${path}`,
              title: `Page ${path}`,
              aria: '- textbox "Email"\n- button "Sign in"',
              elements: CAPTURED_ELEMENTS,
            },
            screenshot: null,
          };
        }
        yield { t: "done", ok: true, error: null };
        return;
      }
      if (input.mode === "pdf") {
        if (pdfFails || !input.pdf?.html) {
          yield { t: "done", ok: false, error: "print failed" };
          return;
        }
        const b64 = Buffer.from(`%PDF-1.7 fake ${input.pdf.html.length}`).toString("base64");
        yield { t: "pdf", seq: 0, last: false, data: b64.slice(0, 8) };
        yield { t: "pdf", seq: 1, last: true, data: b64.slice(8) };
        yield { t: "done", ok: true, error: null };
        return;
      }
      let ran = 0;
      for (const test of input.tests) {
        if (stopped) break;
        if (crashAfter !== null && ran >= crashAfter) {
          throw new Error("container killed");
        }
        await beforeTest?.();
        if (stopped) break;
        for (let retry = 0; retry <= input.retries; retry++) {
          yield { t: "test-begin", id: test.id, retry };
          yield { t: "frame", id: test.id, jpeg: JPEG };
          yield {
            t: "step-end",
            id: test.id,
            title: 'Navigate to "/"',
            category: "pw:api",
            durationMs: 120,
            error: null,
          };
          yield { t: "console", id: test.id, level: "log", text: "app ready" };
          yield {
            t: "net",
            id: test.id,
            method: "GET",
            url: "/api/items",
            status: 200,
            durationMs: 15,
            failed: false,
          };
          const result = outcome(test.code, retry);
          yield {
            t: "test-end",
            id: test.id,
            retry,
            status: result,
            durationMs: 900,
            error:
              result === "passed"
                ? null
                : result === "timedOut"
                  ? "Test timeout exceeded."
                  : "expect(locator).toBeVisible() failed",
          };
          if (result === "passed") break;
        }
        yield { t: "artifact", id: test.id, kind: "trace", seq: 0, last: true, data: PNG };
        ran++;
      }
      yield { t: "done", ok: true, error: null };
    }
    return {
      events: events(),
      control: async (command) => {
        this.controls.push(command);
        if (command === "stop") stopped = true;
      },
    };
  }
}
