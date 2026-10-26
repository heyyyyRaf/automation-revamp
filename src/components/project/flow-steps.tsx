import Link from "next/link";
import { FLOW_STEPS } from "@/lib/domain";
import { cn } from "@/lib/utils";

/**
 * The 8-step progress bar (design: Upload). Finished steps show a tick; the current one is
 * highlighted. Steps whose screen exists link to it.
 */
export function FlowSteps({ projectId, current }: { projectId: string; current: number }) {
  const base = `/projects/${projectId}`;
  const hrefs: (string | null)[] = [
    base,
    `${base}/requirements`,
    `${base}/test-cases`,
    `${base}/test-cases`,
    `${base}/environments`,
    `${base}/scripts`,
    `${base}/runs`,
    null, // the Report screen arrives with Phase 4
  ];
  return (
    <ol
      aria-label="Project progress"
      className="rounded-card border-line m-0 flex list-none flex-wrap items-center gap-x-1 gap-y-2 border bg-white px-5 py-4"
    >
      {FLOW_STEPS.map((label, i) => {
        const done = i < current;
        const now = i === current;
        const inner = (
          <>
            <span
              className={cn(
                "inline-flex size-[22px] items-center justify-center rounded-full text-xs font-bold",
                done && "bg-success-soft text-success",
                now && "bg-link text-white",
                !done && !now && "bg-neutral-soft text-muted",
              )}
              aria-hidden="true"
            >
              {done ? "✓" : i + 1}
            </span>
            {label}
            <span className="sr-only">{done ? " (done)" : now ? " (current step)" : ""}</span>
          </>
        );
        const cls = cn(
          "flex items-center gap-2 rounded-full px-2.5 py-1.5 text-[13px] no-underline",
          now ? "bg-accent-soft font-bold text-accent-strong" : "font-medium",
          done ? "text-success" : !now && "text-muted",
        );
        const href = hrefs[i];
        return (
          <li key={label} aria-current={now ? "step" : undefined}>
            {href ? (
              <Link href={href} className={cn(cls, "hover:bg-page")}>
                {inner}
              </Link>
            ) : (
              <span className={cls}>{inner}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
