"use client";

import { Download, Eye, FileText, Link2, RotateCcw, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { api, ApiError } from "@/lib/api-client";
import { CATEGORY_INFO, STATUS_LABEL, isInProgress, type DocumentItem } from "@/lib/documents";
import { formatBytes, formatDate } from "@/lib/utils";
import { DOCUMENT_CATEGORIES, type DocumentCategoryName } from "@/lib/validation";

const POLL_MS = 3000;

export function DocumentsWorkspace({
  projectId,
  initialDocuments,
  canWrite,
}: {
  projectId: string;
  initialDocuments: DocumentItem[];
  canWrite: boolean;
}) {
  const [documents, setDocuments] = useState(initialDocuments);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const base = `/api/projects/${projectId}/documents`;

  const refresh = useCallback(async () => {
    try {
      const { documents: fresh } = await api<{ documents: DocumentItem[] }>(base);
      setDocuments(fresh);
    } catch {
      // Keep showing the last known list; the next poll will retry.
    }
  }, [base]);

  const anyInProgress = documents.some((d) => isInProgress(d.extractionStatus));
  useEffect(() => {
    if (!anyInProgress) return;
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [anyInProgress, refresh]);

  function report(err: unknown, fallback: string) {
    setMessage({ tone: "error", text: err instanceof ApiError ? err.message : fallback });
  }

  async function onDelete(doc: DocumentItem) {
    if (!window.confirm(`Remove “${doc.originalName}” from this project?`)) return;
    try {
      await api(`${base}/${doc.id}`, { method: "DELETE" });
      setDocuments((ds) => ds.filter((d) => d.id !== doc.id));
    } catch (err) {
      report(err, "Couldn't remove the file.");
    }
  }

  async function onRetry(doc: DocumentItem) {
    try {
      const { document } = await api<{ document: DocumentItem }>(`${base}/${doc.id}/retry`, {
        method: "POST",
      });
      setDocuments((ds) => ds.map((d) => (d.id === doc.id ? document : d)));
    } catch (err) {
      report(err, "Couldn't retry.");
    }
  }

  function onAdded(doc: DocumentItem) {
    setDocuments((ds) => [doc, ...ds]);
    setMessage({ tone: "success", text: `“${doc.originalName}” was added.` });
  }

  return (
    <div className="flex flex-col gap-4">
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      <div className="grid gap-4 lg:grid-cols-3">
        {DOCUMENT_CATEGORIES.map((category) => (
          <UploadArea
            key={category}
            category={category}
            uploadUrl={base}
            disabled={!canWrite}
            onAdded={onAdded}
            onError={(err) => report(err, "Upload failed. Please try again.")}
          />
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Uploaded files</CardTitle>
          <CardDescription>
            {documents.length === 0
              ? "Nothing uploaded yet."
              : `${documents.length} item${documents.length === 1 ? "" : "s"}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {documents.length === 0 ? (
            <p className="rounded-lg bg-slate-50 p-6 text-center text-slate-600">
              Your uploaded files will appear here.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {documents.map((doc) => (
                <DocumentRow
                  key={doc.id}
                  doc={doc}
                  projectId={projectId}
                  canWrite={canWrite}
                  onDelete={() => void onDelete(doc)}
                  onRetry={() => void onRetry(doc)}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function UploadArea({
  category,
  uploadUrl,
  disabled,
  onAdded,
  onError,
}: {
  category: DocumentCategoryName;
  uploadUrl: string;
  disabled: boolean;
  onAdded: (doc: DocumentItem) => void;
  onError: (err: unknown) => void;
}) {
  const info = CATEGORY_INFO[category];
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputId = `upload-${category}`;

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.set("category", category);
        form.set("file", file);
        const { document } = await api<{ document: DocumentItem }>(uploadUrl, { form });
        onAdded(document);
      }
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function addLink(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const url = new FormData(formEl).get("url");
    setBusy(true);
    try {
      const { document } = await api<{ document: DocumentItem }>(uploadUrl, { json: { url } });
      onAdded(document);
      formEl.reset();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle>{info.title}</CardTitle>
        <CardDescription>{info.help}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!disabled) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (!disabled) void upload(e.dataTransfer.files);
          }}
          className={`flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-5 text-center ${
            dragging ? "border-accent bg-accent-soft" : "border-slate-300"
          }`}
        >
          <Upload className="size-7 text-slate-400" aria-hidden />
          <p className="text-sm text-slate-600">Drag files here, or</p>
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            multiple
            accept={info.accept}
            className="sr-only"
            disabled={disabled || busy}
            onChange={(e) => void upload(e.target.files)}
          />
          <Button
            type="button"
            variant="secondary"
            disabled={disabled || busy}
            onClick={() => inputRef.current?.click()}
            aria-controls={inputId}
          >
            {busy ? "Uploading…" : "Choose files"}
          </Button>
          <p className="text-xs text-slate-500">{info.types} · up to 25 MB each</p>
        </div>
        {category === "FIGMA" && (
          <form onSubmit={addLink} className="flex gap-2">
            <label htmlFor="figma-url" className="sr-only">
              Figma link
            </label>
            <Input
              id="figma-url"
              name="url"
              type="url"
              placeholder="https://www.figma.com/design/…"
              required
              disabled={disabled || busy}
            />
            <Button
              type="submit"
              variant="secondary"
              disabled={disabled || busy}
              aria-label="Add Figma link"
            >
              <Link2 aria-hidden />
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function DocumentRow({
  doc,
  projectId,
  canWrite,
  onDelete,
  onRetry,
}: {
  doc: DocumentItem;
  projectId: string;
  canWrite: boolean;
  onDelete: () => void;
  onRetry: () => void;
}) {
  const status = STATUS_LABEL[doc.extractionStatus];
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <FileText className="size-5 shrink-0 text-slate-400" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{doc.originalName}</p>
        <p className="text-sm text-slate-500">
          {CATEGORY_INFO[doc.category].title}
          {doc.sizeBytes != null && ` · ${formatBytes(doc.sizeBytes)}`}
          {doc.pageCount != null && ` · ${doc.pageCount} pages`}
          {doc.ocrUsed && " · read with OCR"} · {doc.uploadedBy.name} · {formatDate(doc.createdAt)}
        </p>
        {doc.extractionError && (
          <p
            className={`text-sm ${doc.extractionStatus === "FAILED" ? "text-red-600" : "text-amber-700"}`}
          >
            {doc.extractionError}
          </p>
        )}
      </div>
      <Badge tone={status.tone}>{status.label}</Badge>
      <div className="flex gap-1">
        {doc.extractionStatus === "SUCCEEDED" && (
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/projects/${projectId}/documents/${doc.id}`}>
              <Eye aria-hidden /> View text
            </Link>
          </Button>
        )}
        {doc.source === "LINK" && doc.linkUrl ? (
          <Button variant="ghost" size="sm" asChild>
            <a href={doc.linkUrl} target="_blank" rel="noopener noreferrer nofollow">
              <Link2 aria-hidden /> Open
            </a>
          </Button>
        ) : (
          <Button variant="ghost" size="sm" asChild>
            <a
              href={`/api/projects/${projectId}/documents/${doc.id}/file`}
              aria-label={`Download ${doc.originalName}`}
            >
              <Download aria-hidden />
            </a>
          </Button>
        )}
        {canWrite && doc.extractionStatus === "FAILED" && (
          <Button variant="ghost" size="sm" onClick={onRetry}>
            <RotateCcw aria-hidden /> Try again
          </Button>
        )}
        {canWrite && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            aria-label={`Remove ${doc.originalName}`}
          >
            <Trash2 aria-hidden />
          </Button>
        )}
      </div>
    </li>
  );
}
