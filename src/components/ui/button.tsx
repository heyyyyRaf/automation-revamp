import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] px-5 text-[15px] font-semibold no-underline transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-[18px] [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-accent text-white hover:bg-accent-hover hover:text-white",
        secondary: "border border-control bg-white text-ink hover:bg-page hover:text-ink",
        soft: "border border-accent bg-accent-soft text-accent-strong hover:bg-white",
        outline: "border border-accent bg-white text-accent-strong hover:bg-accent-soft",
        ghost: "text-ink-2 hover:bg-page hover:text-ink",
        /** "Reject" style: quiet, warning-coloured text. */
        warn: "border border-control bg-white text-warn hover:bg-warn-faint hover:text-warn",
        danger: "bg-warn text-white hover:bg-warn-ink hover:text-white",
        dashed:
          "border border-dashed border-accent-line bg-accent-faint text-accent-strong hover:bg-accent-soft",
      },
      size: {
        default: "",
        sm: "min-h-9 rounded-lg px-3.5 text-[13px]",
        lg: "min-h-12 px-6 text-base",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

/** Rounded filter chip ("All 128", "Needs review 2"). */
export function Chip({
  active,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "focus-visible:ring-accent inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13px] focus-visible:ring-2 focus-visible:outline-none",
        active
          ? "border-accent bg-accent-soft text-accent-strong font-semibold"
          : "border-control text-ink-2 hover:bg-page bg-white",
        className,
      )}
      {...props}
    />
  );
}
