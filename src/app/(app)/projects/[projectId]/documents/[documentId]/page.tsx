import type { Metadata } from "next";
import { PageHeader } from "@/components/project/page-header";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DOCUMENT_TAG_LABELS } from "@/lib/domain";
import { requireAuthPage } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-guard";
import { getDocument } from "@/server/services/documents";
import { getProject } from "@/server/services/projects";

export const metadata: Metadata = { title: "Document text" };

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ projectId: string; documentId: string }>;
}) {
  const { projectId, documentId } = await params;
  const auth = await requireAuthPage();
  const project = await orNotFound(getProject(auth, projectId));
  const doc = await orNotFound(getDocument(auth, projectId, documentId));
  const isImage = doc.mimeType === "image/png" || doc.mimeType === "image/jpeg";

  return (
    <>
      <PageHeader
        crumbs={[
          { label: "Projects", href: "/projects" },
          { label: project.name, href: `/projects/${projectId}` },
          { label: doc.originalName },
        ]}
        title={doc.originalName}
        subtitle={[
          DOCUMENT_TAG_LABELS[doc.typeTag],
          doc.pageCount != null && !isImage ? `${doc.pageCount} pages` : null,
          doc.ocrUsed ? "read with OCR (check for recognition mistakes)" : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      />
      {doc.extractionError && <Alert tone="info">{doc.extractionError}</Alert>}
      <Card>
        <CardHeader>
          <CardTitle>
            {isImage ? "What the assistant saw in this image" : "Text read from this file"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Rendered as plain text — React escapes it; uploaded content is never treated as HTML. */}
          <pre className="bg-page text-ink max-h-[70vh] overflow-auto rounded-lg p-4 font-sans text-sm whitespace-pre-wrap">
            {doc.extractedText ?? "No text available yet."}
          </pre>
        </CardContent>
      </Card>
    </>
  );
}
