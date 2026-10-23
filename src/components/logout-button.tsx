"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  async function logout() {
    setPending(true);
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      // Even if the server call fails, leave the app; the session expires on its own.
    }
    router.replace("/login");
    router.refresh();
  }
  return (
    <Button variant="ghost" size="sm" onClick={() => void logout()} disabled={pending}>
      <LogOut aria-hidden />
      Sign out
    </Button>
  );
}
