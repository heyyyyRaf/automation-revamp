"use client";

import "./globals.css";

/** Last-resort boundary for errors in the root layout itself. */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">
        <main className="mx-auto flex max-w-lg flex-col items-center gap-4 px-6 py-24 text-center">
          <h1 className="text-2xl font-semibold">Traxion QA is having trouble</h1>
          <p className="text-slate-600">Please try again in a moment. Your saved work is safe.</p>
          <button
            type="button"
            onClick={reset}
            className="bg-accent hover:bg-accent-hover min-h-11 rounded-lg px-5 font-medium text-white"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
