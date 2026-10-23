import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { can } from "@/lib/permissions";
import { requireAuthPage } from "@/server/auth/current-user";
import { listUsers } from "@/server/services/users";
import { UsersManager } from "./users-manager";

export const metadata: Metadata = { title: "Users" };

export default async function UsersPage() {
  const auth = await requireAuthPage();
  if (!can(auth.user.role, "users:manage")) notFound();
  const users = await listUsers();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Users</h1>
        <p className="mt-1 text-slate-600">
          Create accounts for your team. There is no public sign-up — only Admins can add people.
        </p>
      </div>
      <UsersManager initialUsers={users} currentUserId={auth.user.id} />
    </div>
  );
}
