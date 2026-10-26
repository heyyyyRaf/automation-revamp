import { Loader2 } from "lucide-react";
import type * as React from "react";

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-card border-control flex flex-col items-center gap-3 border border-dashed bg-white px-6 py-12 text-center">
      {icon && <div className="text-muted [&_svg]:size-10">{icon}</div>}
      <h3 className="text-ink text-[17px] font-bold">{title}</h3>
      <p className="text-muted max-w-md">{description}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="text-muted flex items-center justify-center gap-3 py-16" role="status">
      <Loader2 className="size-6 animate-spin" aria-hidden />
      <span>{label}</span>
    </div>
  );
}
