import { AIError } from "@/server/ai/types";

export type PartResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Runs AI calls for independent parts with limited parallelism (NFR-4) and retries each
 * failed part on its own (NFR-6), so one bad chunk doesn't cost the whole analysis.
 * A non-retryable AI error (budget reached, AI not configured) stops everything: retrying
 * other parts can't succeed either.
 */
export async function runParts<P, T>(
  parts: readonly P[],
  work: (part: P, attempt: number) => Promise<T>,
  options: {
    concurrency: number;
    retries: number;
    signal: AbortSignal;
    onDone?: (done: number, total: number) => Promise<void> | void;
  },
): Promise<PartResult<T>[]> {
  const results: PartResult<T>[] = new Array(parts.length);
  let next = 0;
  let done = 0;
  let fatal: unknown;

  const worker = async () => {
    while (fatal === undefined && !options.signal.aborted) {
      const index = next++;
      if (index >= parts.length) return;
      const part = parts[index] as P;
      let result: PartResult<T> | undefined;
      for (let attempt = 1; attempt <= options.retries + 1 && !result; attempt++) {
        try {
          result = { ok: true, value: await work(part, attempt) };
        } catch (err) {
          // Only AI failures are per-part. Anything else (database, a bug) fails the job,
          // and so does an AI error no retry can fix.
          if (!(err instanceof AIError) || !err.retryable || options.signal.aborted) {
            fatal = err;
            return;
          }
          if (attempt > options.retries) result = { ok: false, error: err.userMessage };
        }
      }
      results[index] = result ?? { ok: false, error: "This part couldn't be processed." };
      done++;
      await options.onDone?.(done, parts.length);
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, options.concurrency) }, worker));
  if (fatal !== undefined) throw fatal;
  return results;
}
