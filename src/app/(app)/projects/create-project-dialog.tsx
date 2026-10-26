"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PlusIcon } from "@/components/icons";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { api, ApiError } from "@/lib/api-client";

/**
 * New project (FR-1.1). The creator owns it by default; an Admin may pick another owner
 * (`owners` is only filled for Admins).
 */
export function CreateProjectDialog({
  owners,
  currentUserId,
  trigger = "primary",
}: {
  owners: { id: string; name: string }[];
  currentUserId: string;
  trigger?: "primary" | "outline";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);
  const idp = trigger; // two dialogs can be on the page: keep field ids unique

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    try {
      const ownerId = form.get("ownerId");
      const { project } = await api<{ project: { id: string } }>("/api/projects", {
        json: {
          name: form.get("name"),
          description: form.get("description") || undefined,
          ...(ownerId && ownerId !== currentUserId ? { ownerId } : {}),
        },
      });
      router.push(`/projects/${project.id}`);
    } catch (err) {
      setError(
        err instanceof ApiError ? err : new ApiError("Couldn't create the project.", 0, "UNKNOWN"),
      );
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger === "primary" ? (
          <Button>
            <PlusIcon /> New project
          </Button>
        ) : (
          <Button variant="outline">Start a project</Button>
        )}
      </DialogTrigger>
      <DialogContent
        title="New project"
        description="Give the project a name your team will recognise."
      >
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {error && !error.fieldErrors["name"] && <Alert tone="error">{error.message}</Alert>}
          <Field
            label="Project name"
            htmlFor={`${idp}-name`}
            error={error?.fieldErrors["name"]?.[0]}
          >
            <Input
              id={`${idp}-name`}
              name="name"
              required
              maxLength={120}
              placeholder="e.g. Leave Request Portal"
            />
          </Field>
          <Field
            label="Description (optional)"
            htmlFor={`${idp}-description`}
            hint="Team, app or release being tested."
          >
            <Textarea id={`${idp}-description`} name="description" maxLength={2000} />
          </Field>
          {owners.length > 0 && (
            <Field
              label="Owner"
              htmlFor={`${idp}-owner`}
              hint="The owner manages members and settings."
            >
              <Select id={`${idp}-owner`} name="ownerId" defaultValue={currentUserId}>
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.id === currentUserId ? `${o.name} (you)` : o.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create project"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
