/**
 * Playwright reporter used inside the sandbox: turns test/step lifecycle into NDJSON events
 * on stdout. The runner entry scrubs secrets and forwards them to the worker.
 */
import { basename } from "node:path";
import type {
  FullResult,
  Reporter,
  TestCase,
  TestError,
  TestResult,
  TestStep,
} from "@playwright/test/reporter";

const STEP_CATEGORIES = new Set(["pw:api", "expect", "test.step"]);

/**
 * Steps a tester should see: actions and checks from the script. Skips fixture setup (located
 * inside Playwright) and the harness's own live-view screenshots, which aren't test actions.
 */
function isScriptStep(step: TestStep): boolean {
  if (!STEP_CATEGORIES.has(step.category)) return false;
  if (step.category !== "pw:api") return true;
  const file = (step.location?.file ?? "").replaceAll("\\", "/");
  if (!file || file.includes("node_modules")) return false;
  return !(file.endsWith("/tests/traxion.ts") && /^Screenshot\b/i.test(step.title));
}

function emit(event: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

/** Test files are named <runTestId>.spec.ts. */
function idOf(test: TestCase): string {
  return basename(test.location.file).replace(/\.spec\.ts$/, "");
}

function errorText(result: TestResult): string | null {
  const e = result.errors[0] ?? result.error;
  if (!e) return null;
  // Strip ANSI colour codes from Playwright messages.
  return (e.message ?? e.value ?? "Error").replace(/\u001b\[[0-9;]*m/g, "").slice(0, 8000);
}

export default class TraxionReporter implements Reporter {
  printsToStdio(): boolean {
    return true;
  }

  onTestBegin(test: TestCase, result: TestResult): void {
    emit({ t: "test-begin", id: idOf(test), retry: result.retry });
  }

  onStepBegin(test: TestCase, _result: TestResult, step: TestStep): void {
    if (!isScriptStep(step)) return;
    emit({
      t: "step-begin",
      id: idOf(test),
      title: step.title.slice(0, 1000),
      category: step.category,
    });
  }

  onStepEnd(test: TestCase, _result: TestResult, step: TestStep): void {
    if (!isScriptStep(step)) return;
    emit({
      t: "step-end",
      id: idOf(test),
      title: step.title.slice(0, 1000),
      category: step.category,
      durationMs: Math.max(0, Math.round(step.duration)),
      error: step.error?.message?.replace(/\u001b\[[0-9;]*m/g, "").slice(0, 4000) ?? null,
    });
  }

  onStdOut(chunk: string | Buffer, test: void | TestCase): void {
    const id = test ? idOf(test) : null;
    for (const line of chunk.toString().split("\n")) {
      if (!line) continue;
      if (line.startsWith("__TQA_FRAME__")) {
        if (id) emit({ t: "frame", id, jpeg: line.slice("__TQA_FRAME__".length) });
      } else if (line.startsWith("__TQA_CONSOLE__") || line.startsWith("__TQA_NET__")) {
        const console = line.startsWith("__TQA_CONSOLE__");
        try {
          const data = JSON.parse(
            line.slice((console ? "__TQA_CONSOLE__" : "__TQA_NET__").length),
          ) as Record<string, unknown>;
          if (id) emit({ ...data, t: console ? "console" : "net", id });
        } catch {
          // malformed line: drop it
        }
      } else {
        emit({ t: "log", id, stream: "stdout", text: line.slice(0, 4000) });
      }
    }
  }

  onStdErr(chunk: string | Buffer, test: void | TestCase): void {
    const id = test ? idOf(test) : null;
    for (const line of chunk.toString().split("\n")) {
      if (line) emit({ t: "log", id, stream: "stderr", text: line.slice(0, 4000) });
    }
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const id = idOf(test);
    emit({
      t: "test-end",
      id,
      status: result.status,
      retry: result.retry,
      durationMs: Math.max(0, Math.round(result.duration)),
      error: errorText(result),
    });
    const files = result.attachments
      .filter((a) => a.path && (a.name === "trace" || a.contentType === "image/png"))
      .map((a) => ({ kind: a.name === "trace" ? "trace" : "screenshot", path: a.path }));
    // Internal line for the runner entry (not forwarded): which files to upload.
    emit({ t: "_attachments", id, files });
  }

  /** Errors outside any test (e.g. a script that does not compile). */
  onError(error: TestError): void {
    const text = (error.message ?? error.value ?? "Error").replace(/\u001b\[[0-9;]*m/g, "");
    for (const line of text.split("\n").filter(Boolean).slice(0, 20)) {
      emit({ t: "log", id: null, stream: "stderr", text: line.slice(0, 4000) });
    }
  }

  onEnd(result: FullResult): void {
    emit({ t: "_end", status: result.status });
  }
}
