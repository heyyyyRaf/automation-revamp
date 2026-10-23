import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CATEGORY_INFO } from "@/lib/documents";
import { requireAuthPage } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-guard";
import { getDocument } from "@/server/services/documents";

export const metadata: Metadata = { title: "Document text" };

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ projectId: string; documentId: string }>;
}) {
  const { projectId, documentId } = await params;
  const auth = await requireAuthPage();
  const doc = await orNotFound(getDocument(auth, projectId, documentId));

  return (
    <div className="flex flex-col gap-4">
      <Link
        href={`/projects/${projectId}`}
        className="inline-flex min-h-11 items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
      >
        <ChevronLeft className="size-4" aria-hidden /> Back to project
      </Link>
      <div>
        <h1 className="text-2xl font-semibold break-words">{doc.originalName}</h1>
        <p className="text-slate-600">
          {CATEGORY_INFO[doc.category].title}
          {doc.pageCount != null && ` · ${doc.pageCount} pages`}
          {doc.ocrUsed && " · read with OCR (check for recognition mistakes)"}
        </p>
      </div>
      {doc.extractionError && <Alert tone="info">{doc.extractionError}</Alert>}
      <Card>
        <CardHeader>
          <CardTitle>Text we read from this file</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Rendered as plain text — React escapes it; uploaded content is never treated as HTML. */}
          <pre className="max-h-[70vh] overflow-auto rounded-lg bg-slate-50 p-4 font-sans text-sm whitespace-pre-wrap text-slate-800">
            {doc.extractedText ?? "No text available yet."}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
