"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/form";
import { api, ApiError } from "@/lib/api-client";

export function CreateProjectDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    try {
      const { project } = await api<{ project: { id: string } }>("/api/projects", {
        json: { name: form.get("name"), description: form.get("description") || undefined },
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
        <Button>
          <Plus aria-hidden /> New project
        </Button>
      </DialogTrigger>
      <DialogContent
        title="New project"
        description="Give the project a name your team will recognise."
      >
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {error && !error.fieldErrors["name"] && <Alert tone="error">{error.message}</Alert>}
          <Field label="Project name" htmlFor="name" error={error?.fieldErrors["name"]?.[0]}>
            <Input
              id="name"
              name="name"
              required
              maxLength={120}
              placeholder="e.g. Customer portal"
            />
          </Field>
          <Field
            label="Description (optional)"
            htmlFor="description"
            hint="What app or release is being tested?"
          >
            <Textarea id="description" name="description" maxLength={2000} />
          </Field>
          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create project"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
