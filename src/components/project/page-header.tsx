import Link from "next/link";
import type * as React from "react";
import { Badge } from "@/components/ui/badge";

/** Breadcrumb + title + subtitle + actions, as on every project screen of the design. */
export function PageHeader({
  crumbs,
  title,
  subtitle,
  archived,
  actions,
}: {
  crumbs: { label: string; href?: string }[];
  title: string;
  subtitle?: React.ReactNode;
  archived?: boolean;
  actions?: React.ReactNode;
}) {
  return (
    <>
      <nav aria-label="Breadcrumb" className="text-muted text-sm">
        {crumbs.map((c, i) => (
          <span key={`${c.label}-${i}`}>
            {i > 0 && <span aria-hidden="true"> / </span>}
            {c.href ? (
              <Link href={c.href} className="no-underline">
                {c.label}
              </Link>
            ) : (
              <span aria-current="page">{c.label}</span>
            )}
          </span>
        ))}
      </nav>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[28px] font-bold break-words">{title}</h1>
            {archived && <Badge>Archived</Badge>}
          </div>
          {subtitle && <div className="text-muted">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
      </div>
    </>
  );
}
