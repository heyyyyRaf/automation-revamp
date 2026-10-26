"use client";

import Link from "next/link";
import type * as React from "react";
import { useMemo, useState } from "react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Chip } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { ProjectsIcon } from "@/components/icons";
import { activityLabel, plural } from "@/lib/format";
import { ProgressBar } from "@/components/ui/progress-bar";

export type StageName = "NOT_STARTED" | "ANALYSING" | "REVIEWING" | "FAILING" | "REPORT_READY";

export interface DashboardProject {
  id: string;
  name: string;
  status: "ACTIVE" | "ARCHIVED";
  ownerName: string;
  stage: StageName;
  lastPassRate: number | null;
  testCaseCount: number;
  draftCount: number;
  activity: { kind: "ran" | "uploaded" | "updated" | "created"; at: string };
}

const STAGES: Record<StageName, { label: string; tone: BadgeTone }> = {
  REPORT_READY: { label: "Report ready", tone: "success" },
  REVIEWING: { label: "Reviewing cases", tone: "info" },
  ANALYSING: { label: "Analysing docs", tone: "purple" },
  FAILING: { label: "Failing tests", tone: "warning" },
  NOT_STARTED: { label: "Not started", tone: "neutral" },
};

const VERB = { ran: "Ran", uploaded: "Uploaded", updated: "Updated", created: "Created" } as const;

/** Same threshold as the server's stage logic: below it the bar turns orange. */
const PASS_RATE_OK = 85;

type Filter = "all" | "review" | "failing";

/**
 * Projects screen (design: Main). Server-rendered parts come in as slots; this component owns
 * the search box and the filter chips.
 */
export function ProjectsDashboard({
  title,
  subtitle,
  actions,
  tiles,
  aside,
  notice,
  projects,
  canCreate,
}: {
  title: string;
  subtitle: string;
  actions: React.ReactNode;
  tiles: React.ReactNode;
  aside: React.ReactNode;
  notice?: React.ReactNode;
  projects: DashboardProject[];
  canCreate: boolean;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const needsReview = projects.filter((p) => p.draftCount > 0);
  const failing = projects.filter((p) => p.stage === "FAILING");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = filter === "review" ? needsReview : filter === "failing" ? failing : projects;
    return q ? base.filter((p) => p.name.toLowerCase().includes(q)) : base;
  }, [query, filter, projects, needsReview, failing]);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[28px] font-bold">{title}</h1>
          <p className="text-muted">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="project-search" className="sr-only">
            Search projects
          </label>
          <input
            id="project-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects"
            className="border-control focus-visible:border-accent focus-visible:ring-accent/30 h-11 w-[260px] max-w-full rounded-[10px] border bg-white px-4 focus-visible:ring-2 focus-visible:outline-none"
          />
          {actions}
        </div>
      </div>
      {notice}
      {tiles}
      <div className="flex flex-wrap items-start gap-6">
        <section
          aria-labelledby="projects-heading"
          className="flex min-w-0 flex-[999_1_560px] flex-col gap-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="projects-heading" className="text-[19px] font-bold">
              Projects
            </h2>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter projects">
              <Chip active={filter === "all"} onClick={() => setFilter("all")}>
                All {projects.length}
              </Chip>
              <Chip active={filter === "review"} onClick={() => setFilter("review")}>
                Needs review {needsReview.length}
              </Chip>
              <Chip active={filter === "failing"} onClick={() => setFilter("failing")}>
                Failing {failing.length}
              </Chip>
            </div>
          </div>

          {projects.length === 0 ? (
            <EmptyState
              icon={<ProjectsIcon />}
              title="No projects yet"
              description={
                canCreate
                  ? "Create your first project, then upload its requirements to get started."
                  : "You haven't been added to any project yet. Ask your Admin / QA Lead to add you."
              }
            />
          ) : shown.length === 0 ? (
            <p className="rounded-card border-control text-muted border border-dashed bg-white p-6 text-center">
              No projects match.
            </p>
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
              {shown.map((p) => {
                const stage = STAGES[p.stage];
                const ran = p.lastPassRate !== null;
                return (
                  <li key={p.id}>
                    <Link
                      href={`/projects/${p.id}`}
                      className="rounded-card border-line text-ink hover:border-accent-line hover:text-ink focus-visible:ring-accent flex h-full flex-col gap-3.5 border bg-white p-5 no-underline transition-colors focus-visible:ring-2 focus-visible:outline-none"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 flex-col gap-1">
                          <span className="text-base font-bold">{p.name}</span>
                          <span className="text-muted text-[13px]">Owner: {p.ownerName}</span>
                        </div>
                        {p.status === "ARCHIVED" ? (
                          <Badge>Archived</Badge>
                        ) : (
                          <Badge tone={stage.tone}>{stage.label}</Badge>
                        )}
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <div className="flex justify-between text-[13px]">
                          <span className="text-muted">Last run pass rate</span>
                          <span className="font-semibold">
                            {ran ? `${p.lastPassRate}%` : "Not run yet"}
                          </span>
                        </div>
                        <ProgressBar
                          value={p.lastPassRate ?? 0}
                          label={ran ? `Pass rate ${p.lastPassRate}%` : "Not run yet"}
                          barClass={
                            (p.lastPassRate ?? 0) >= PASS_RATE_OK ? "bg-success-bar" : "bg-warn-bar"
                          }
                        />
                      </div>
                      <div className="border-line-soft text-muted mt-auto flex justify-between gap-2 border-t pt-3 text-[13px]">
                        <span>{plural(p.testCaseCount, "test case")}</span>
                        <span suppressHydrationWarning>
                          {activityLabel(VERB[p.activity.kind], p.activity.at)}
                        </span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        {aside}
      </div>
    </>
  );
}
