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

  onTestBegin(test: TestCase): void {
    emit({ t: "test-begin", id: idOf(test) });
  }

  onStepEnd(test: TestCase, _result: TestResult, step: TestStep): void {
    if (!STEP_CATEGORIES.has(step.category)) return;
    // Only actions from the script (or the harness wrapping it) — skip fixture setup such as
    // "Launch browser", whose location is inside Playwright itself or missing.
    const file = step.location?.file ?? "";
    if (step.category === "pw:api" && (!file || file.includes("node_modules"))) return;
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
