import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { can } from "@/lib/permissions";
import { requireAuthPage } from "@/server/auth/current-user";
import { listAuditLog } from "@/server/services/audit-log";
import { listProjects } from "@/server/services/projects";
import { listUsers } from "@/server/services/users";
import { AuditViewer } from "./audit-viewer";

export const metadata: Metadata = { title: "Audit log" };

/** FRD audit_log: every change, who made it, with before/after values. Admin / QA Lead only. */
export default async function AuditPage() {
  const auth = await requireAuthPage();
  if (!can(auth.user.role, "audit:read")) notFound();
  const [first, projects, users] = await Promise.all([
    listAuditLog(auth, {}),
    listProjects(auth, { includeArchived: true }),
    listUsers(),
  ]);
  return (
    <>
      <nav aria-label="Breadcrumb" className="text-muted text-sm">
        <Link href="/settings" className="no-underline">
          Settings
        </Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">Audit log</span>
      </nav>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[28px] font-bold">Audit log</h1>
        <p className="text-muted">
          Who did what and when. Changes show the values before and after. Secrets never appear
          here.
        </p>
      </div>
      <AuditViewer
        initial={first}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
        users={users.map((u) => ({ id: u.id, name: u.name }))}
      />
    </>
  );
}
