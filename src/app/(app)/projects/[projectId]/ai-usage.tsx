"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { api, ApiError } from "@/lib/api-client";
import type { AiBudgetItem } from "@/lib/types";

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
    <div className="flex flex-col gap-2 rounded-lg bg-slate-50 p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-slate-700">AI usage this month</span>
        <span className="text-slate-600">
          {fmt(budget.used)} of {fmt(budget.cap)} tokens ({pct}%)
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-200" aria-hidden>
        <div
          className={`h-full rounded-full ${pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-accent"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {canEdit &&
        (editing ? (
          <form onSubmit={save} className="flex flex-wrap items-center gap-2">
            <label htmlFor="token-cap" className="text-slate-700">
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
            {error && <span className="text-red-600">{error}</span>}
            <span className="w-full text-slate-500">Leave empty to use the default limit.</span>
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
