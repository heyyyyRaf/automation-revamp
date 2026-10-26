"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { api, ApiError } from "@/lib/api-client";
import type { TargetItem } from "@/lib/types";

const STATUS: Record<TargetItem["status"], { label: string; tone: BadgeTone }> = {
  PENDING: { label: "Waiting for the Lead", tone: "info" },
  APPROVED: { label: "Approved", tone: "success" },
  REVOKED: { label: "Revoked", tone: "warning" },
};

const NETWORK: Record<TargetItem["network"], string> = {
  public: "Public address",
  private: "Private network",
  blocked: "Blocked network",
  unresolved: "Doesn't resolve right now",
};

/**
 * NFR-3: tests only run against addresses the Lead approved. Testers request; the Lead
 * approves (deciding whether private-network addresses are allowed) or revokes.
 */
export function AddressesCard({
  projectId,
  targets,
  canRequest,
  canApprove,
}: {
  projectId: string;
  targets: TargetItem[];
  canRequest: boolean;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const base = `/api/projects/${projectId}/targets`;

  async function request(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setPending(true);
    setError(null);
    try {
      await api(base, { json: { url: f.get("url"), note: f.get("note") || undefined } });
      form.reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't send the request.");
    } finally {
      setPending(false);
    }
  }

  async function decide(t: TargetItem, decision: "APPROVE" | "REVOKE", allowPrivate = false) {
    setError(null);
    try {
      await api(`${base}/${t.id}`, {
        method: "PATCH",
        json: { decision, allowPrivateNetwork: allowPrivate },
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save the decision.");
    }
  }

  return (
    <Card className="flex flex-[1_1_320px] flex-col gap-4 p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-[17px] font-bold">Addresses</h2>
        <p className="text-muted text-[13px] leading-normal">
          Tests only run against addresses the Admin / QA Lead approved — never production by
          accident.
        </p>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {targets.length === 0 ? (
        <p className="text-muted text-[13px]">No address requested yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {targets.map((t) => (
            <li
              key={t.id}
              className="border-line-soft flex flex-col gap-1.5 border-b pb-3 last:border-b-0"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[13px] break-all">{t.origin}</span>
                <Badge tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Badge>
              </div>
              <span className="text-muted text-xs">
                {NETWORK[t.network]}
                {t.allowPrivateNetwork && " · private network allowed"} · requested by{" "}
                {t.requestedBy.name}
                {t.note && ` · “${t.note}”`}
              </span>
              {canApprove && t.status === "PENDING" && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => void decide(t, "APPROVE", t.network === "private")}
                  >
                    {t.network === "private" ? "Approve (private network)" : "Approve"}
                  </Button>
                  <Button size="sm" variant="warn" onClick={() => void decide(t, "REVOKE")}>
                    Decline
                  </Button>
                </div>
              )}
              {canApprove && t.status === "APPROVED" && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="self-start"
                  onClick={() => void decide(t, "REVOKE")}
                >
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canRequest && (
        <form onSubmit={request} className="flex flex-col gap-3">
          <Field
            label="Request an address"
            htmlFor="target-url"
            hint="e.g. https://staging.example.com"
          >
            <Input id="target-url" name="url" type="url" required maxLength={500} />
          </Field>
          <Field label="Note for the Lead (optional)" htmlFor="target-note">
            <Input id="target-note" name="note" maxLength={500} />
          </Field>
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            className="self-start"
            disabled={pending}
          >
            {pending ? "Sending…" : "Send request"}
          </Button>
        </form>
      )}
    </Card>
  );
}
