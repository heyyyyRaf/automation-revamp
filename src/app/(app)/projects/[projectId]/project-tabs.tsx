"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function ProjectTabs({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const base = `/projects/${projectId}`;
  const tabs = [
    {
      href: base,
      label: "1 · Upload & analysis",
      match: (p: string) => p === base || p.startsWith(`${base}/documents`),
    },
    {
      href: `${base}/requirements`,
      label: "2 · Requirements",
      match: (p: string) => p.startsWith(`${base}/requirements`),
    },
    {
      href: `${base}/test-cases`,
      label: "3 · Test cases",
      match: (p: string) => p.startsWith(`${base}/test-cases`),
    },
  ];
  return (
    <nav aria-label="Project steps" className="flex flex-wrap gap-1 border-b border-slate-200">
      {tabs.map((t) => {
        const active = t.match(pathname);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px inline-flex min-h-11 items-center border-b-2 px-4 font-medium",
              active
                ? "border-accent text-accent-strong"
                : "border-transparent text-slate-600 hover:text-slate-900",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
