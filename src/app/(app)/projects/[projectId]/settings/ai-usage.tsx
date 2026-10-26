"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { api, ApiError } from "@/lib/api-client";
import type { AiBudgetItem } from "@/lib/types";
import { ProgressBar } from "@/components/ui/progress-bar";

const fmt = (n: number) => n.toLocaleString();

/** Monthly AI token usage meter; Admins can change the project's cap. */
export function AiUsage({
  projectId,
  budget,
  onChange,
  canEdit,
}: {
  projectId: string;
  budget: AiBudgetItem;
  onChange: (b: AiBudgetItem) => void;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pct = budget.cap > 0 ? Math.min(100, Math.round((budget.used / budget.cap) * 100)) : 100;

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const raw = String(new FormData(e.currentTarget).get("cap") ?? "").replace(/[,\s]/g, "");
    setError(null);
    try {
      const res = await api<{ budget: AiBudgetItem }>(`/api/projects/${projectId}/ai-budget`, {
        method: "PATCH",
        json: { monthlyTokenCap: raw ? Number(raw) : null },
      });
      onChange(res.budget);
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save the limit.");
    }
  }

  return (
    <div className="bg-page flex flex-col gap-2 rounded-lg p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-ink-2 font-semibold">AI usage this month</span>
        <span className="text-muted">
          {fmt(budget.used)} of {fmt(budget.cap)} tokens ({pct}%)
        </span>
      </div>
      <ProgressBar
        value={pct}
        label={`AI usage ${pct}% of the monthly limit`}
        barClass={pct >= 70 ? "bg-warn-bar" : "bg-accent"}
      />
      {canEdit &&
        (editing ? (
          <form onSubmit={save} className="flex flex-wrap items-center gap-2">
            <label htmlFor="token-cap" className="text-ink-2">
              Monthly limit (tokens)
            </label>
            <Input
              id="token-cap"
              name="cap"
              inputMode="numeric"
              defaultValue={budget.cap}
              className="w-40"
            />
            <Button type="submit" size="sm">
              Save
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            {error && <span className="text-warn">{error}</span>}
            <span className="text-muted w-full">Leave empty to use the default limit.</span>
          </form>
        ) : (
          <div>
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              Change monthly limit
            </Button>
          </div>
        ))}
    </div>
  );
}
