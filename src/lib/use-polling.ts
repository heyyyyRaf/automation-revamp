"use client";

import { useEffect, useRef } from "react";

/** Calls `fn` every `ms` while `active` is true. Errors are ignored; the next tick retries. */
export function usePolling(fn: () => Promise<void>, active: boolean, ms = 3000): void {
  const saved = useRef(fn);
  useEffect(() => {
    saved.current = fn;
  }, [fn]);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      saved.current().catch(() => undefined);
    }, ms);
    return () => clearInterval(id);
  }, [active, ms]);
}
