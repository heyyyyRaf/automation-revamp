"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import {
  CheckIcon,
  CodeIcon,
  ListIcon,
  PlayIcon,
  ProjectsIcon,
  SettingsIcon,
} from "@/components/icons";
import { LogoutButton } from "@/components/logout-button";
import { LAST_PROJECT_COOKIE } from "@/lib/nav";
import { cn } from "@/lib/utils";

const PROJECT_RE = /^\/projects\/([a-z0-9]{20,40})(?:\/|$)/;

/**
 * Left sidebar from the design. "Test cases", "Test scripts" and "Runs and reports" open the
 * current project's page; outside a project they ask you to pick one first.
 */
export function Sidebar({ user }: { user: { name: string; roleLabel: string } }) {
  const pathname = usePathname();
  const pick = useSearchParams().get("pick");
  const projectId = PROJECT_RE.exec(pathname)?.[1];
  // Remember the open project, so the sidebar can return to it from outside a project.
  useEffect(() => {
    if (projectId) {
      const secure = window.location.protocol === "https:" ? "; Secure" : "";
      document.cookie = `${LAST_PROJECT_COOKIE}=${projectId}; Path=/; Max-Age=2592000; SameSite=Lax${secure}`;
    }
  }, [projectId]);
  // "Choose a project" page reached from a module link: highlight that module, not Projects.
  const picking = pathname === "/projects" && pick ? pick : null;
  const inProject = (section: string) =>
    projectId ? `/projects/${projectId}/${section}` : `/projects?pick=${section}`;

  const items = [
    {
      href: "/projects",
      label: "Projects",
      Icon: ProjectsIcon,
      active:
        (pathname === "/projects" && !picking) ||
        (projectId !== undefined &&
          !/\/(test-cases|scripts|runs|report|defects)(\/|$)/.test(
            pathname.slice(`/projects/${projectId}`.length),
          )),
    },
    {
      href: inProject("test-cases"),
      label: "Test cases",
      Icon: ListIcon,
      active: picking === "test-cases" || /\/test-cases(\/|$)/.test(pathname),
    },
    {
      href: inProject("scripts"),
      label: "Test scripts",
      Icon: CodeIcon,
      active: picking === "scripts" || /\/scripts(\/|$)/.test(pathname),
    },
    {
      href: inProject("runs"),
      label: "Runs and reports",
      Icon: PlayIcon,
      active: picking === "runs" || /\/(runs|report|defects)(\/|$)/.test(pathname),
    },
    {
      href: "/settings",
      label: "Settings",
      Icon: SettingsIcon,
      active: pathname.startsWith("/settings"),
    },
  ];

  return (
    // Stays in place while the page scrolls (tablet and up); on phones it sits above the page.
    <aside className="border-line box-border flex max-w-full flex-[1_1_220px] flex-col gap-6 border-r bg-white px-4 py-6 md:sticky md:top-0 md:h-screen md:flex-[0_0_220px] md:overflow-y-auto">
      <Link
        href="/projects"
        className="text-ink hover:text-ink flex items-center gap-2.5 px-2 no-underline"
      >
        <span className="bg-accent flex size-9 items-center justify-center rounded-[10px] text-white">
          <CheckIcon size={20} />
        </span>
        <span className="text-[17px] font-bold">Traxion QA</span>
      </Link>

      <nav aria-label="Main" className="flex flex-col gap-1">
        {items.map(({ href, label, Icon, active }) => (
          <Link
            key={label}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-[10px] p-3 no-underline",
              active
                ? "bg-accent-soft text-accent-strong hover:text-accent-strong font-semibold"
                : "text-ink-2 hover:bg-page hover:text-ink font-medium",
            )}
          >
            <Icon />
            {label}
          </Link>
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-4">
        <div className="bg-page flex flex-col gap-2 rounded-xl p-4">
          <div className="text-sm font-semibold">Need a hand?</div>
          <p className="text-muted text-[13px] leading-normal">
            Upload any FRD or user story and the assistant drafts your first test cases.
          </p>
          <Link href="/guide" className="text-[13px] font-semibold">
            Read the quick guide
          </Link>
        </div>
        <div className="flex items-center justify-between gap-2 px-2">
          <div className="min-w-0 text-sm">
            <p className="truncate font-semibold">{user.name}</p>
            <p className="text-muted text-[13px]">{user.roleLabel}</p>
          </div>
          <LogoutButton />
        </div>
      </div>
    </aside>
  );
}
