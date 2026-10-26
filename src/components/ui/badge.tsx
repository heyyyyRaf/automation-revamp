import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs leading-none font-semibold",
  {
    variants: {
      tone: {
        neutral: "bg-neutral-soft text-ink-2",
        info: "bg-accent-soft text-accent-strong",
        success: "bg-success-soft text-success",
        warning: "bg-warn-soft text-warn",
        purple: "bg-purple-soft text-purple",
        danger: "bg-warn-soft text-warn",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;

export function Badge({
  className,
  tone,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

/** Status with a coloured dot ("● Approved"). */
export function StatusDot({
  label,
  color,
  className,
}: {
  label: string;
  color: string;
  className?: string;
}) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-[13px] font-semibold", color, className)}
    >
      <span className="size-2 rounded-full bg-current" aria-hidden />
      {label}
    </span>
  );
}
