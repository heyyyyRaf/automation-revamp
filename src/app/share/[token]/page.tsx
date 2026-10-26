import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { AppError } from "@/server/errors";
import { getClientIp } from "@/server/http/client-ip";
import { getSharedReport } from "@/server/services/shares";
import { SharedReport } from "./shared-report";

export const metadata: Metadata = {
  title: "Shared run report",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

/** FR-9.4 option (b): a read-only report behind an expiring public link. No sign-in. */
export default async function SharedReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const h = await headers();
  let result: Awaited<ReturnType<typeof getSharedReport>>;
  try {
    result = await getSharedReport(token, {
      ip: getClientIp(h),
      requestId: h.get("x-request-id") ?? "",
    });
  } catch (e) {
    if (e instanceof AppError && e.status === 404) notFound();
    if (e instanceof AppError && e.status === 429) {
      return (
        <main className="mx-auto max-w-xl p-10">
          <h1 className="text-[22px] font-bold">Too many tries</h1>
          <p className="text-muted mt-2">Please wait a few minutes, then open the link again.</p>
        </main>
      );
    }
    throw e;
  }
  return <SharedReport token={token} report={result.report} expiresAt={result.expiresAt} />;
}
