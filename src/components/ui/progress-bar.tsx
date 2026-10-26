import { cn } from "@/lib/utils";

/**
 * Widths as classes, in 5% steps. The strict CSP blocks `style="width:…"` attributes in
 * server-rendered HTML, so bars never use inline styles. The literal list lets Tailwind
 * generate every class.
 */
const WIDTHS = [
  "w-0",
  "w-[5%]",
  "w-[10%]",
  "w-[15%]",
  "w-[20%]",
  "w-[25%]",
  "w-[30%]",
  "w-[35%]",
  "w-[40%]",
  "w-[45%]",
  "w-[50%]",
  "w-[55%]",
  "w-[60%]",
  "w-[65%]",
  "w-[70%]",
  "w-[75%]",
  "w-[80%]",
  "w-[85%]",
  "w-[90%]",
  "w-[95%]",
  "w-full",
] as const;

export function widthClass(percent: number): string {
  const step = Math.round(Math.min(100, Math.max(0, percent)) / 5);
  return WIDTHS[step] ?? "w-0";
}

export function ProgressBar({
  value,
  label,
  min = 0,
  height = "h-2",
  barClass = "bg-accent",
  className,
}: {
  /** 0–100. */
  value: number;
  /** Accessible name, e.g. "Pass rate 91%". */
  label: string;
  /** Show at least this much so a started job is visibly moving. */
  min?: number;
  height?: string;
  barClass?: string;
  className?: string;
}) {
  const shown = Math.max(min, value);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
      className={cn("bg-neutral-soft overflow-hidden rounded-full", height, className)}
    >
      <div className={cn("rounded-full transition-all", height, barClass, widthClass(shown))} />
    </div>
  );
}
