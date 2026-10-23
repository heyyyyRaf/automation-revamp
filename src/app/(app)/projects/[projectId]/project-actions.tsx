"use client";

import { Archive, ArchiveRestore } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api-client";

export function ProjectActions({ projectId, archived }: { projectId: string; archived: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function toggle() {
    const question = archived
      ? "Restore this project so it can be edited again?"
      : "Archive this project? It becomes read-only and is hidden from the project list.";
    if (!window.confirm(question)) return;
    setPending(true);
    try {
      await api(`/api/projects/${projectId}`, {
        method: "PATCH",
        json: { status: archived ? "ACTIVE" : "ARCHIVED" },
      });
      router.refresh();
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Button variant="secondary" onClick={() => void toggle()} disabled={pending}>
      {archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
      {archived ? "Restore project" : "Archive project"}
    </Button>
  );
}
