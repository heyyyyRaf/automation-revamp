"use client";

import { KeyRound, UserPlus } from "lucide-react";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { api, ApiError } from "@/lib/api-client";
import { ROLES, ROLE_LABELS, type RoleName } from "@/lib/permissions";
import { formatDate } from "@/lib/utils";

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: RoleName;
  isActive: boolean;
  lastLoginAt: string | Date | null;
}

export function UsersManager({
  initialUsers,
  currentUserId,
}: {
  initialUsers: UserRow[];
  currentUserId: string;
}) {
  const [users, setUsers] = useState(initialUsers);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  function replace(user: UserRow) {
    setUsers((us) => us.map((u) => (u.id === user.id ? user : u)));
  }

  async function update(userId: string, patch: Partial<Pick<UserRow, "role" | "isActive">>) {
    setMessage(null);
    try {
      const { user } = await api<{ user: UserRow }>(`/api/admin/users/${userId}`, {
        method: "PATCH",
        json: patch,
      });
      replace(user);
      setMessage({ tone: "success", text: `${user.name} was updated.` });
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof ApiError ? err.message : "Update failed." });
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle>{users.length} people</CardTitle>
        <CreateUserDialog
          onCreated={(u) => {
            setUsers((us) => [...us, u].sort((a, b) => a.name.localeCompare(b.name)));
            setMessage({ tone: "success", text: `Account created for ${u.name}.` });
          }}
        />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {message && <Alert tone={message.tone}>{message.text}</Alert>}
        <ul className="divide-line-soft divide-y">
          {users.map((u) => {
            const self = u.id === currentUserId;
            return (
              <li key={u.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-48 flex-1">
                  <p className="font-medium">
                    {u.name} {self && <span className="text-muted text-sm">(you)</span>}
                  </p>
                  <p className="text-muted text-sm">
                    {u.email} ·{" "}
                    {u.lastLoginAt
                      ? `last sign-in ${formatDate(u.lastLoginAt)}`
                      : "never signed in"}
                  </p>
                </div>
                {!u.isActive && <Badge tone="warning">Deactivated</Badge>}
                <label htmlFor={`role-${u.id}`} className="sr-only">
                  Role for {u.name}
                </label>
                <Select
                  id={`role-${u.id}`}
                  className="w-48"
                  value={u.role}
                  disabled={self}
                  onChange={(e) => void update(u.id, { role: e.target.value as RoleName })}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </Select>
                <ResetPasswordDialog
                  user={u}
                  onDone={(text) => setMessage({ tone: "success", text })}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={self}
                  onClick={() => void update(u.id, { isActive: !u.isActive })}
                >
                  {u.isActive ? "Deactivate" : "Reactivate"}
                </Button>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function CreateUserDialog({ onCreated }: { onCreated: (u: UserRow) => void }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    try {
      const { user } = await api<{ user: UserRow }>("/api/admin/users", {
        json: {
          name: f.get("name"),
          email: f.get("email"),
          role: f.get("role"),
          password: f.get("password"),
        },
      });
      onCreated(user);
      setOpen(false);
    } catch (err) {
      setError(
        err instanceof ApiError ? err : new ApiError("Couldn't create the user.", 0, "UNKNOWN"),
      );
    } finally {
      setPending(false);
    }
  }

  const fe = (k: string) => error?.fieldErrors[k]?.[0];
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus aria-hidden /> Add person
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Add a person"
        description="Share the temporary password with them privately. They can sign in right away."
      >
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {error && Object.keys(error.fieldErrors).length === 0 && (
            <Alert tone="error">{error.message}</Alert>
          )}
          <Field label="Full name" htmlFor="new-name" error={fe("name")}>
            <Input id="new-name" name="name" required maxLength={100} />
          </Field>
          <Field label="Email" htmlFor="new-email" error={fe("email")}>
            <Input id="new-email" name="email" type="email" required autoComplete="off" />
          </Field>
          <Field
            label="Role"
            htmlFor="new-role"
            hint="Admin / QA Lead manages people and projects. Testers do the QA work. Viewers can only look."
          >
            <Select id="new-role" name="role" defaultValue="QA_TESTER">
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Temporary password"
            htmlFor="new-password"
            hint="At least 12 characters."
            error={fe("password")}
          >
            <Input
              id="new-password"
              name="password"
              type="password"
              required
              minLength={12}
              autoComplete="new-password"
            />
          </Field>
          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create account"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ user, onDone }: { user: UserRow; onDone: (msg: string) => void }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const password = new FormData(e.currentTarget).get("password");
    setPending(true);
    setError(null);
    try {
      await api(`/api/admin/users/${user.id}`, { method: "PATCH", json: { password } });
      setOpen(false);
      onDone(`Password reset for ${user.name}. They have been signed out everywhere.`);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? (err.fieldErrors["password"]?.[0] ?? err.message)
          : "Reset failed.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={`Reset password for ${user.name}`}>
          <KeyRound aria-hidden />
        </Button>
      </DialogTrigger>
      <DialogContent title={`Reset password for ${user.name}`}>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Field
            label="New password"
            htmlFor={`pw-${user.id}`}
            hint="At least 12 characters."
            error={error ?? undefined}
          >
            <Input
              id={`pw-${user.id}`}
              name="password"
              type="password"
              required
              minLength={12}
              autoComplete="new-password"
            />
          </Field>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Set new password"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
