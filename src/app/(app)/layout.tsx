import Link from "next/link";
import { ROLE_LABELS, can } from "@/lib/permissions";
import { requireAuthPage } from "@/server/auth/current-user";
import { LogoutButton } from "@/components/logout-button";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireAuthPage();
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <nav className="flex items-center gap-1" aria-label="Main">
            <Link href="/projects" className="text-accent mr-4 text-lg font-semibold">
              Traxion QA
            </Link>
            <Link
              href="/projects"
              className="inline-flex min-h-11 items-center rounded-lg px-3 text-slate-700 hover:bg-slate-100"
            >
              Projects
            </Link>
            {can(user.role, "users:manage") && (
              <Link
                href="/admin/users"
                className="inline-flex min-h-11 items-center rounded-lg px-3 text-slate-700 hover:bg-slate-100"
              >
                Users
              </Link>
            )}
          </nav>
          <div className="flex items-center gap-3">
            <div className="text-right text-sm">
              <p className="font-medium">{user.name}</p>
              <p className="text-slate-500">{ROLE_LABELS[user.role]}</p>
            </div>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
