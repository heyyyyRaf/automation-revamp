"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { api, ApiError } from "@/lib/api-client";
import type { TargetItem } from "@/lib/types";

/**
 * Lead: the URL allowlist (NFR-3). Approve or decline addresses projects asked for, and keep
 * the global list that shared environments use.
 */
export function AddressesAdmin({
  pending,
  globalTargets,
}: {
  pending: TargetItem[];
  globalTargets: TargetItem[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await action();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card id="addresses">
      <CardHeader>
        <CardTitle>Addresses</CardTitle>
        <CardDescription>
          Tests run only against addresses you approve. Private-network addresses (like an internal
          staging server) must be allowed explicitly.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {error && <Alert tone="error">{error}</Alert>}
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-bold">Waiting for you ({pending.length})</h3>
          {pending.length === 0 ? (
            <p className="text-muted text-[13px]">Nothing to approve.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {pending.map((t) => (
                <li
                  key={t.id}
                  className="border-line-soft flex flex-wrap items-center gap-2 border-b pb-3 last:border-b-0"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-[13px] break-all">{t.origin}</span>
                    <span className="text-muted text-xs">
                      {t.project?.name} · asked by {t.requestedBy.name}
                      {t.network === "private" && " · private network"}
                      {t.note && ` · “${t.note}”`}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        api(`/api/projects/${t.project?.id}/targets/${t.id}`, {
                          method: "PATCH",
                          json: {
                            decision: "APPROVE",
                            allowPrivateNetwork: t.network === "private",
                          },
                        }),
                      )
                    }
                  >
                    {t.network === "private" ? "Approve (private network)" : "Approve"}
                  </Button>
                  <Button
                    size="sm"
                    variant="warn"
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        api(`/api/projects/${t.project?.id}/targets/${t.id}`, {
                          method: "PATCH",
                          json: { decision: "REVOKE" },
                        }),
                      )
                    }
                  >
                    Decline
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-bold">For shared environments</h3>
          {globalTargets.length === 0 ? (
            <p className="text-muted text-[13px]">None yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {globalTargets.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[13px] break-all">{t.origin}</span>
                  <Badge tone={t.status === "APPROVED" ? "success" : "warning"}>
                    {t.status === "APPROVED" ? "Approved" : "Revoked"}
                  </Badge>
                  {t.allowPrivateNetwork && <Badge>Private network</Badge>}
                  {t.status === "APPROVED" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        void run(() => api(`/api/admin/targets/${t.id}`, { method: "DELETE" }))
                      }
                    >
                      Revoke
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const f = new FormData(form);
              void run(async () => {
                await api("/api/admin/targets", {
                  json: {
                    url: f.get("url"),
                    allowPrivateNetwork: f.get("private") === "on",
                  },
                });
                form.reset();
              });
            }}
          >
            <Field label="Add an approved address" htmlFor="global-url">
              <Input
                id="global-url"
                name="url"
                type="url"
                required
                maxLength={500}
                placeholder="https://uat.example.com"
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="private" className="accent-accent size-5" />
              Allow private-network addresses for it
            </label>
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              className="self-start"
              disabled={busy}
            >
              Add address
            </Button>
          </form>
        </div>
      </CardContent>
    </Card>
  );
}
