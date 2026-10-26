"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { api, ApiError } from "@/lib/api-client";

/** Name, description and owner (FR-1.1). Owner choices: members who are not Viewers. */
export function ProjectDetailsForm({
  projectId,
  name,
  description,
  ownerId,
  owners,
  disabled,
}: {
  projectId: string;
  name: string;
  description: string | null;
  ownerId: string;
  owners: { id: string; name: string }[];
  disabled: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const next = {
      name: String(f.get("name") ?? ""),
      description: String(f.get("description") ?? "") || null,
      ownerId: String(f.get("ownerId") ?? ownerId),
    };
    if (
      next.ownerId !== ownerId &&
      !window.confirm("Hand this project over? The new owner will manage its members and settings.")
    ) {
      return;
    }
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      await api(`/api/projects/${projectId}`, { method: "PATCH", json: next });
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError("Couldn't save.", 0, "UNKNOWN"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Project details</CardTitle>
        <CardDescription>The owner and Admins / QA Leads can change these.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex max-w-xl flex-col gap-4">
          {error && !error.fieldErrors["name"] && <Alert tone="error">{error.message}</Alert>}
          {saved && <Alert tone="success">Saved.</Alert>}
          <Field label="Project name" htmlFor="p-name" error={error?.fieldErrors["name"]?.[0]}>
            <Input
              id="p-name"
              name="name"
              required
              maxLength={120}
              defaultValue={name}
              disabled={disabled}
            />
          </Field>
          <Field
            label="Description"
            htmlFor="p-description"
            hint="Team, app or release being tested."
          >
            <Textarea
              id="p-description"
              name="description"
              maxLength={2000}
              defaultValue={description ?? ""}
              disabled={disabled}
            />
          </Field>
          <Field
            label="Owner"
            htmlFor="p-owner"
            hint="Only project members who aren't Viewers can own it."
          >
            <Select id="p-owner" name="ownerId" defaultValue={ownerId} disabled={disabled}>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" className="self-start" disabled={disabled || pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
