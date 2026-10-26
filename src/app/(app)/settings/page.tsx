import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { can, ROLE_LABELS } from "@/lib/permissions";
import { requireAuthPage } from "@/server/auth/current-user";
import { effectiveAiSettings } from "@/server/services/settings";
import { listUsers } from "@/server/services/users";
import { UsersManager } from "../admin/users/users-manager";
import { AiSettingsForm } from "./ai-settings-form";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const auth = await requireAuthPage();
  const isLead = can(auth.user.role, "settings:manage");
  const [users, ai] = isLead ? await Promise.all([listUsers(), effectiveAiSettings()]) : [[], null];

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[28px] font-bold">Settings</h1>
        <p className="text-muted">
          {isLead
            ? "Your account, your team and how the assistant runs."
            : "Your account. Admins / QA Leads manage users and AI settings."}
        </p>
      </div>
      <div className="grid max-w-5xl gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Your account</CardTitle>
            <CardDescription>
              Ask an Admin / QA Lead to change your name, email or role.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
              <dt className="text-muted">Name</dt>
              <dd className="font-semibold">{auth.user.name}</dd>
              <dt className="text-muted">Email</dt>
              <dd className="font-semibold">{auth.user.email}</dd>
              <dt className="text-muted">Role</dt>
              <dd className="font-semibold">{ROLE_LABELS[auth.user.role]}</dd>
            </dl>
          </CardContent>
        </Card>
        {isLead && (
          <section id="users" aria-labelledby="users-heading" className="flex flex-col gap-3">
            <div>
              <h2 id="users-heading" className="text-[19px] font-bold">
                Users
              </h2>
              <p className="text-muted text-sm">
                Create accounts for your team. There is no public sign-up — only Admins add people.
              </p>
            </div>
            <UsersManager initialUsers={users} currentUserId={auth.user.id} />
          </section>
        )}
        {ai && <AiSettingsForm initial={ai} />}
      </div>
    </>
  );
}
