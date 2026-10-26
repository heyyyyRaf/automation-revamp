import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CheckIcon } from "@/components/icons";
import { getAuth } from "@/server/auth/current-user";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getAuth()) redirect("/projects");
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="rounded-card border-line w-full max-w-md border bg-white p-8">
        <div className="mb-6 flex flex-col gap-4">
          <div className="flex items-center gap-2.5">
            <span className="bg-accent flex size-9 items-center justify-center rounded-[10px] text-white">
              <CheckIcon size={20} />
            </span>
            <span className="text-[17px] font-bold">Traxion QA</span>
          </div>
          <h1 className="text-[28px] font-bold">Sign in</h1>
          <p className="text-muted -mt-2">
            Use the account your admin created for you. There is no public sign-up.
          </p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
