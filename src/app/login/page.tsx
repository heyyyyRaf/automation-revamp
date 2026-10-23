import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/auth/current-user";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getAuth()) redirect("/projects");
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6">
          <p className="text-accent text-sm font-semibold tracking-wide uppercase">Traxion QA</p>
          <h1 className="mt-1 text-2xl font-semibold">Sign in</h1>
          <p className="mt-1 text-slate-600">
            Use the account your admin created for you. There is no public sign-up.
          </p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
