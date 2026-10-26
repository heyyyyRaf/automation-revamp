"use client";

import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { api, ApiError } from "@/lib/api-client";
import type { ShareItem } from "@/lib/types";

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function CopyField({
  id,
  label,
  value,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  hint?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Field label={label} htmlFor={id} {...(hint ? { hint } : {})}>
      <div className="flex gap-2">
        <Input
          id={id}
          readOnly
          value={value}
          onFocus={(e) => e.target.select()}
          className="font-mono text-[13px]"
        />
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            void navigator.clipboard.writeText(value).then(() => setCopied(true));
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </Field>
  );
}

/**
 * FR-9.4 option (b): every member can copy the members-only link; only the Lead can turn on a
 * public read-only link that expires. The public address is shown once, right after it's made.
 */
export function ShareDialog({
  open,
  onOpenChange,
  projectId,
  runId,
  canShare,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  runId: string;
  canShare: boolean;
}) {
  const base = `/api/projects/${projectId}/runs/${runId}/shares`;
  const [shares, setShares] = useState<ShareItem[] | null>(null);
  const [days, setDays] = useState<1 | 7 | 30>(7);
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    if (!open) return;
    let live = true;
    // The origin is only known in the browser; read it when the dialog opens.
    queueMicrotask(() => live && setOrigin(window.location.origin));
    if (canShare) {
      api<{ shares: ShareItem[] }>(base)
        .then((r) => live && setShares(r.shares))
        .catch(() => live && setError("Couldn't load the public links."));
    }
    return () => {
      live = false;
    };
  }, [open, canShare, base]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const create = () =>
    run(async () => {
      const { share } = await api<{ share: { path: string } }>(base, { json: { days } });
      setCreated(`${window.location.origin}${share.path}`);
      setShares((await api<{ shares: ShareItem[] }>(base)).shares);
    });

  const revoke = (id: string) =>
    run(async () => {
      await api(`${base}/${id}`, { method: "DELETE" });
      setShares((s) => s?.filter((x) => x.id !== id) ?? null);
      setCreated(null);
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setCreated(null);
        onOpenChange(o);
      }}
    >
      <DialogContent title="Share this report">
        <div className="flex flex-col gap-5">
          {error && <Alert tone="error">{error}</Alert>}
          <CopyField
            id="share-members"
            label="Link for project members"
            value={`${origin}/projects/${projectId}/runs/${runId}/report`}
            hint="Only people who can sign in and see this project can open it."
          />

          <div className="border-line-soft flex flex-col gap-3 border-t pt-4">
            <h3 className="font-bold">Public link</h3>
            {!canShare ? (
              <p className="text-muted text-sm">
                Anyone with a public link can read the report without signing in. Only an Admin / QA
                Lead can turn one on.
              </p>
            ) : (
              <>
                <p className="text-muted text-sm">
                  Anyone with the link can read this report — no sign-in, no other project data. It
                  stops working when it expires or when you turn it off.
                </p>
                {created ? (
                  <CopyField
                    id="share-public"
                    label="Public link"
                    value={created}
                    hint="Copy it now: for safety it isn't shown again."
                  />
                ) : (
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="min-w-40 flex-1">
                      <Field label="Expires after" htmlFor="share-days">
                        <Select
                          id="share-days"
                          value={days}
                          onChange={(e) => setDays(Number(e.target.value) as 1 | 7 | 30)}
                        >
                          <option value={1}>1 day</option>
                          <option value={7}>7 days</option>
                          <option value={30}>30 days</option>
                        </Select>
                      </Field>
                    </div>
                    <Button disabled={busy} onClick={() => void create()}>
                      Create public link
                    </Button>
                  </div>
                )}
                {shares && shares.length > 0 && (
                  <ul className="m-0 flex list-none flex-col gap-2 p-0">
                    {shares.map((s) => (
                      <li
                        key={s.id}
                        className="border-line flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
                      >
                        <span>
                          Expires {dateTime.format(new Date(s.expiresAt))}
                          <span className="text-muted"> · by {s.createdBy.name}</span>
                        </span>
                        <Button
                          size="sm"
                          variant="warn"
                          disabled={busy}
                          onClick={() => void revoke(s.id)}
                        >
                          Turn off
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
