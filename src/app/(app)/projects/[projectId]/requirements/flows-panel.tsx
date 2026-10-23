"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/form";
import { api, ApiError } from "@/lib/api-client";
import type { FlowItem } from "@/lib/types";

export function FlowsPanel({
  projectId,
  initialFlows,
  canWrite,
}: {
  projectId: string;
  initialFlows: FlowItem[];
  canWrite: boolean;
}) {
  const [flows, setFlows] = useState(initialFlows);
  const [editing, setEditing] = useState<FlowItem | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/projects/${projectId}/flows`;

  async function reload() {
    const res = await api<{ flows: FlowItem[] }>(base);
    setFlows(res.flows);
  }

  async function remove(f: FlowItem) {
    if (!window.confirm(`Remove the flow “${f.name}”?`)) return;
    try {
      await api(`${base}/${f.id}`, { method: "DELETE" });
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't remove it.");
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle>User flows ({flows.length})</CardTitle>
          <CardDescription>End-to-end journeys through the app, step by step.</CardDescription>
        </div>
        {canWrite && (
          <Button variant="secondary" onClick={() => setEditing("new")}>
            <Plus aria-hidden /> Add flow
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && <Alert tone="error">{error}</Alert>}
        {flows.length === 0 ? (
          <p className="rounded-lg bg-slate-50 p-4 text-slate-600">No flows yet.</p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {flows.map((f) => (
              <li key={f.id} className="rounded-lg border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{f.name}</p>
                    {f.origin === "MANUAL" && <Badge tone="info">Added by tester</Badge>}
                  </div>
                  {canWrite && (
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditing(f)}
                        aria-label={`Edit ${f.name}`}
                      >
                        <Pencil aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void remove(f)}
                        aria-label={`Remove ${f.name}`}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </div>
                  )}
                </div>
                {f.description && <p className="mt-1 text-sm text-slate-600">{f.description}</p>}
                <ol className="mt-2 list-decimal pl-5 text-sm text-slate-800">
                  {f.steps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {editing && (
        <FlowDialog
          base={base}
          flow={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void reload();
          }}
        />
      )}
    </Card>
  );
}

function FlowDialog({
  base,
  flow,
  onClose,
  onSaved,
}: {
  base: string;
  flow: FlowItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const steps = String(f.get("steps") ?? "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      await api(flow ? `${base}/${flow.id}` : base, {
        method: flow ? "PATCH" : "POST",
        json: {
          name: f.get("name"),
          description: String(f.get("description") ?? "") || null,
          steps,
        },
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save the flow.");
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={flow ? "Edit flow" : "Add a flow"}>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="Name" htmlFor="flow-name">
            <Input
              id="flow-name"
              name="name"
              required
              maxLength={200}
              defaultValue={flow?.name ?? ""}
            />
          </Field>
          <Field label="Description (optional)" htmlFor="flow-desc">
            <Textarea
              id="flow-desc"
              name="description"
              maxLength={2000}
              defaultValue={flow?.description ?? ""}
            />
          </Field>
          <Field label="Steps" htmlFor="flow-steps" hint="One step per line.">
            <Textarea
              id="flow-steps"
              name="steps"
              required
              rows={6}
              defaultValue={flow?.steps.join("\n") ?? ""}
            />
          </Field>
          <Button type="submit">Save flow</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
