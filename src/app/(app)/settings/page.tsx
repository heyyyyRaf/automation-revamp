import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { can, ROLE_LABELS } from "@/lib/permissions";
import { requireAuthPage } from "@/server/auth/current-user";
import { listSharedEnvironments } from "@/server/services/environments";
import { effectiveAiSettings } from "@/server/services/settings";
import { listGlobalTargets, listPendingTargets } from "@/server/services/targets";
import { listUsers } from "@/server/services/users";
import { UsersManager } from "../admin/users/users-manager";
import { EnvironmentsWorkspace } from "../projects/[projectId]/environments/environments-workspace";
import { AddressesAdmin } from "./addresses-admin";
import { AiSettingsForm } from "./ai-settings-form";
import { ChangePasswordForm } from "./change-password-form";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const auth = await requireAuthPage();
  const isLead = can(auth.user.role, "settings:manage");
  const lead = isLead
    ? await Promise.all([
        listUsers(),
        effectiveAiSettings(),
        listPendingTargets(auth),
        listGlobalTargets(auth),
        listSharedEnvironments(auth),
      ])
    : null;

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
              Ask an Admin / QA Lead to change your name, email or role. You can change your own
              password below.
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
            <div className="border-line-soft mt-5 border-t pt-5">
              <ChangePasswordForm />
            </div>
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
            <UsersManager initialUsers={lead?.[0] ?? []} currentUserId={auth.user.id} />
          </section>
        )}
        {lead && <AddressesAdmin pending={lead[2]} globalTargets={lead[3]} />}
        {lead && (
          <div id="shared-environments" className="flex flex-col gap-2">
            <p className="text-muted text-sm">
              Shared environments are created here and can be used by every project. Projects run
              their check from their own Environments page.
            </p>
            <div className="flex">
              <EnvironmentsWorkspace
                projectId={null}
                apiBase="/api/admin/environments"
                environments={lead[4]}
                targets={lead[3]}
                canManage
                canManageShared
                title="Shared environments"
              />
            </div>
          </div>
        )}
        {lead && <AiSettingsForm initial={lead[1]} />}
        {isLead && (
          <Card>
            <CardHeader>
              <CardTitle>Audit log</CardTitle>
              <CardDescription>
                Every sign-in, approval, run and change, with who made it and the values before and
                after.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="secondary" asChild>
                <Link href="/settings/audit">Open the audit log</Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
