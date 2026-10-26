"use client";

import { UserMinus, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/form";
import { api, ApiError } from "@/lib/api-client";
import { ROLE_LABELS, type RoleName } from "@/lib/permissions";

interface Member {
  id: string;
  user: { id: string; name: string; email: string; role: RoleName; isActive: boolean };
}

interface UserOption {
  id: string;
  name: string;
  email: string;
  role: RoleName;
}

export function MembersPanel({
  projectId,
  ownerId,
  members,
  canManage,
  users,
}: {
  projectId: string;
  ownerId: string;
  members: Member[];
  canManage: boolean;
  users: UserOption[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const memberIds = new Set(members.map((m) => m.user.id));
  const candidates = users.filter((u) => !memberIds.has(u.id) && u.role !== "ADMIN");

  async function run(action: () => Promise<unknown>) {
    setPending(true);
    setError(null);
    try {
      await action();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Team</CardTitle>
        <CardDescription>
          People who can see this project. The owner and Admins / QA Leads manage who is on it;
          Admins see every project automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && <Alert tone="error">{error}</Alert>}
        <ul className="divide-line-soft divide-y">
          {members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{m.user.name}</p>
                <p className="text-muted text-sm">{m.user.email}</p>
              </div>
              {m.user.id === ownerId && <Badge tone="info">Owner</Badge>}
              <Badge>{ROLE_LABELS[m.user.role]}</Badge>
              {!m.user.isActive && <Badge tone="warning">Deactivated</Badge>}
              {canManage && m.user.id !== ownerId && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  aria-label={`Remove ${m.user.name}`}
                  onClick={() =>
                    void run(() =>
                      api(`/api/projects/${projectId}/members/${m.user.id}`, { method: "DELETE" }),
                    )
                  }
                >
                  <UserMinus aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
        {canManage && candidates.length > 0 && (
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const userId = new FormData(e.currentTarget).get("userId");
              void run(() => api(`/api/projects/${projectId}/members`, { json: { userId } }));
            }}
          >
            <label htmlFor="add-member" className="sr-only">
              Person to add
            </label>
            <Select
              id="add-member"
              name="userId"
              className="max-w-sm flex-1"
              required
              defaultValue=""
            >
              <option value="" disabled>
                Choose a person…
              </option>
              {candidates.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({ROLE_LABELS[u.role]})
                </option>
              ))}
            </Select>
            <Button type="submit" variant="secondary" disabled={pending}>
              <UserPlus aria-hidden /> Add to project
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
