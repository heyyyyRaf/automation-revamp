import { Sidebar } from "@/components/app-shell/sidebar";
import { ROLE_LABELS } from "@/lib/permissions";
import { requireAuthPage } from "@/server/auth/current-user";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireAuthPage();
  return (
    <div className="bg-page flex min-h-screen flex-wrap md:flex-nowrap">
      <Sidebar user={{ name: user.name, roleLabel: ROLE_LABELS[user.role] }} />
      <main className="box-border flex min-w-0 flex-[999_1_560px] flex-col gap-6 px-4 pt-8 pb-12 sm:px-10">
        {children}
      </main>
    </div>
  );
}
