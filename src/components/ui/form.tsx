import type * as React from "react";
import { cn } from "@/lib/utils";

const control =
  "w-full rounded-lg border border-control bg-white px-3 text-[15px] text-ink placeholder:text-muted/70 focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 focus-visible:outline-none disabled:opacity-60 aria-invalid:border-warn";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(control, "min-h-11", className)} {...props} />;
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(control, "min-h-24 py-2", className)} {...props} />;
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(control, "min-h-11", className)} {...props} />;
}

/** Label + control + hint/error. Pass the control's id as `htmlFor`. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-ink-2 text-sm font-semibold">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-muted text-[13px]">{hint}</p>}
      {error && (
        <p className="text-warn text-[13px]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
