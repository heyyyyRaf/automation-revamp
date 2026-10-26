"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Route-level error boundary. Shows a friendly message, never the raw error.
 * The digest correlates with the server log entry.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex max-w-lg flex-col items-center gap-4 px-6 py-24 text-center">
      <h1 className="text-[28px] font-bold">Something went wrong</h1>
      <p className="text-muted">
        This page couldn&apos;t load. Your saved work is safe. Try again, or go back to your
        projects.
      </p>
      {error.digest && <p className="text-muted text-sm">Reference: {error.digest}</p>}
      <div className="flex gap-3">
        <Button onClick={reset}>Try again</Button>
        <Button variant="secondary" asChild>
          <Link href="/projects">Go to projects</Link>
        </Button>
      </div>
    </main>
  );
}
