import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";

const STYLES = {
  error: { box: "bg-warn-soft text-warn-ink", Icon: AlertCircle },
  success: { box: "bg-success-soft text-success", Icon: CheckCircle2 },
  info: { box: "bg-accent-soft text-accent-strong", Icon: Info },
} as const;

export function Alert({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: keyof typeof STYLES;
  title?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const { box, Icon } = STYLES[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("flex items-start gap-3.5 rounded-xl px-[18px] py-3.5 text-sm", box, className)}
    >
      <Icon className="mt-px size-[22px] shrink-0" aria-hidden />
      <div className="flex flex-col gap-1 leading-relaxed">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div>{children}</div>}
      </div>
    </div>
  );
}
