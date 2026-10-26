"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { DocumentIcon, FlowIcon, ScreenIcon } from "@/components/icons";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api, ApiError } from "@/lib/api-client";
import {
  CATEGORY_INFO,
  STATUS_LABEL,
  fileExt,
  isInProgress,
  type DocumentItem,
} from "@/lib/documents";
import { DOCUMENT_TAG_LABELS, DOCUMENT_TAGS, type DocumentTagName } from "@/lib/domain";
import { plural } from "@/lib/format";
import { cn, formatBytes } from "@/lib/utils";
import type { DocumentCategoryName } from "@/lib/validation";

const POLL_MS = 3000;

const CARD_STYLE: Record<
  DocumentCategoryName,
  { Icon: typeof DocumentIcon; iconBox: string; zone: string; browse: string }
> = {
  REQUIREMENTS: {
    Icon: DocumentIcon,
    iconBox: "bg-accent-soft text-link",
    zone: "border-accent-line bg-accent-faint",
    browse: "text-link",
  },
  SYSTEM_FLOW: {
    Icon: FlowIcon,
    iconBox: "bg-purple-soft text-purple",
    zone: "border-purple-line bg-purple-faint",
    browse: "text-purple",
  },
  FIGMA: {
    Icon: ScreenIcon,
    iconBox: "bg-warn-faint text-warn",
    zone: "",
    browse: "text-warn",
  },
};

/** "1. Add your project files" (design: Upload): three upload groups and the file list. */
export function ProjectFiles({
  projectId,
  initialDocuments,
  canWrite,
}: {
  projectId: string;
  initialDocuments: DocumentItem[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [documents, setDocuments] = useState(initialDocuments);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const base = `/api/projects/${projectId}/documents`;

  const refresh = useCallback(async () => {
    try {
      const { documents: fresh } = await api<{ documents: DocumentItem[] }>(base);
      setDocuments((prev) => {
        // A file finished reading: refresh the server parts (analysis button, counts).
        const finished = prev.some(
          (p) =>
            isInProgress(p.extractionStatus) &&
            !isInProgress(fresh.find((f) => f.id === p.id)?.extractionStatus ?? "SUCCEEDED"),
        );
        if (finished) router.refresh();
        return fresh;
      });
    } catch {
      // Keep the last known list; the next poll retries.
    }
  }, [base, router]);

  const anyInProgress = documents.some((d) => isInProgress(d.extractionStatus));
  useEffect(() => {
    if (!anyInProgress) return;
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [anyInProgress, refresh]);

  function report(err: unknown, fallback: string) {
    setMessage({ tone: "error", text: err instanceof ApiError ? err.message : fallback });
  }

  function onAdded(doc: DocumentItem) {
    setDocuments((ds) => [doc, ...ds]);
    setMessage(null);
    router.refresh();
  }

  async function onTag(doc: DocumentItem, typeTag: DocumentTagName) {
    try {
      const { document } = await api<{ document: DocumentItem }>(`${base}/${doc.id}`, {
        method: "PATCH",
        json: { typeTag },
      });
      setDocuments((ds) => ds.map((d) => (d.id === doc.id ? document : d)));
    } catch (err) {
      report(err, "Couldn't change the tag.");
    }
  }

  async function onDelete(doc: DocumentItem) {
    if (!window.confirm(`Remove “${doc.originalName}” from this project?`)) return;
    try {
      await api(`${base}/${doc.id}`, { method: "DELETE" });
      setDocuments((ds) => ds.filter((d) => d.id !== doc.id && d.derivedFromId !== doc.id));
      router.refresh();
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

  const countIn = (c: DocumentCategoryName) =>
    documents.filter((d) => d.category === c && !d.derivedFromId).length;
  const figmaLink = documents.find((d) => d.source === "LINK");
  const figmaFrames = figmaLink
    ? documents.filter((d) => d.derivedFromId === figmaLink.id).length
    : 0;

  return (
    <section
      aria-labelledby="files-heading"
      className="flex min-w-0 flex-[999_1_520px] flex-col gap-4"
    >
      <h2 id="files-heading" className="text-[19px] font-bold">
        1. Add your project files
      </h2>
      <p className="text-muted -mt-2 text-sm">
        Add what you have. Even one file is enough to start — more files mean better test cases.
      </p>
      {message && <Alert tone={message.tone}>{message.text}</Alert>}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3.5">
        {(["REQUIREMENTS", "SYSTEM_FLOW"] as const).map((category) => (
          <UploadCard
            key={category}
            category={category}
            uploadUrl={base}
            disabled={!canWrite}
            added={countIn(category)}
            onAdded={onAdded}
            onError={(err) => report(err, "Upload failed. Please try again.")}
          />
        ))}
        <FigmaCard
          uploadUrl={base}
          disabled={!canWrite}
          linked={figmaLink ?? null}
          frames={figmaFrames}
          uploaded={
            documents.filter(
              (d) => d.category === "FIGMA" && d.source === "FILE" && !d.derivedFromId,
            ).length
          }
          onAdded={onAdded}
          onError={(err) => report(err, "Couldn't add the Figma design.")}
        />
      </div>

      <Card className="overflow-hidden">
        <div className="border-line-soft flex flex-wrap justify-between gap-2 border-b px-5 py-3.5 text-sm">
          <span className="font-semibold">All files ({documents.length})</span>
          <span className="text-muted">Change a tag if a file landed in the wrong group</span>
        </div>
        {documents.length === 0 ? (
          <p className="text-muted px-5 py-8 text-center">Your files will appear here.</p>
        ) : (
          <ul>
            {documents.map((doc) => (
              <FileRow
                key={doc.id}
                doc={doc}
                projectId={projectId}
                canWrite={canWrite}
                onTag={(t) => void onTag(doc, t)}
                onDelete={() => void onDelete(doc)}
                onRetry={() => void onRetry(doc)}
              />
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

function useUpload(
  uploadUrl: string,
  category: DocumentCategoryName,
  onAdded: (d: DocumentItem) => void,
  onError: (e: unknown) => void,
) {
  const [busy, setBusy] = useState(false);
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
    }
  }
  return { busy, upload };
}

function UploadCard({
  category,
  uploadUrl,
  disabled,
  added,
  onAdded,
  onError,
}: {
  category: "REQUIREMENTS" | "SYSTEM_FLOW";
  uploadUrl: string;
  disabled: boolean;
  added: number;
  onAdded: (doc: DocumentItem) => void;
  onError: (err: unknown) => void;
}) {
  const info = CATEGORY_INFO[category];
  const style = CARD_STYLE[category];
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const { busy, upload } = useUpload(uploadUrl, category, onAdded, onError);
  const inputId = `upload-${category}`;

  return (
    <Card className="flex flex-col gap-3 p-[18px]">
      <CardTitleRow Icon={style.Icon} iconBox={style.iconBox} title={info.title} help={info.help} />
      <label
        htmlFor={inputId}
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
        className={cn(
          "flex flex-col items-center gap-1 rounded-xl border-2 border-dashed px-3 py-[18px] text-center",
          style.zone,
          dragging && "border-accent bg-accent-soft",
          disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
        )}
      >
        <span className="text-sm font-semibold">
          {busy ? (
            "Uploading…"
          ) : (
            <>
              Drop files or <span className={cn("underline", style.browse)}>browse</span>
            </>
          )}
        </span>
        <span className="text-muted text-xs">{info.types}</span>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          multiple
          accept={info.accept}
          className="sr-only"
          disabled={disabled || busy}
          onChange={(e) => {
            void upload(e.target.files).then(() => {
              if (inputRef.current) inputRef.current.value = "";
            });
          }}
        />
      </label>
      {added > 0 && (
        <div className="text-success text-[13px] font-semibold">{plural(added, "file")} added</div>
      )}
    </Card>
  );
}

function FigmaCard({
  uploadUrl,
  disabled,
  linked,
  frames,
  uploaded,
  onAdded,
  onError,
}: {
  uploadUrl: string;
  disabled: boolean;
  linked: DocumentItem | null;
  frames: number;
  uploaded: number;
  onAdded: (doc: DocumentItem) => void;
  onError: (err: unknown) => void;
}) {
  const style = CARD_STYLE.FIGMA;
  const info = CATEGORY_INFO.FIGMA;
  const [busyLink, setBusyLink] = useState(false);
  const { busy, upload } = useUpload(uploadUrl, "FIGMA", onAdded, onError);

  async function addLink(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const url = new FormData(formEl).get("url");
    setBusyLink(true);
    try {
      const { document } = await api<{ document: DocumentItem }>(uploadUrl, { json: { url } });
      onAdded(document);
      formEl.reset();
    } catch (err) {
      onError(err);
    } finally {
      setBusyLink(false);
    }
  }

  const linkStatus = !linked
    ? null
    : isInProgress(linked.extractionStatus)
      ? "Linked · importing screens…"
      : linked.extractionStatus === "FAILED"
        ? null
        : `Linked · ${plural(frames, "screen")} found`;

  return (
    <Card className="flex flex-col gap-3 p-[18px]">
      <CardTitleRow Icon={style.Icon} iconBox={style.iconBox} title={info.title} help={info.help} />
      <form onSubmit={addLink} className="flex flex-col gap-1.5">
        <label htmlFor="figma-link" className="text-ink-2 text-xs font-semibold">
          Figma file link
        </label>
        <div className="flex gap-2">
          <input
            id="figma-link"
            name="url"
            type="url"
            required
            disabled={disabled || busyLink}
            placeholder="https://www.figma.com/design/…"
            className="border-control focus-visible:border-accent focus-visible:ring-accent/30 h-10 min-w-0 flex-1 rounded-lg border px-3 text-[13px] focus-visible:ring-2 focus-visible:outline-none"
          />
          <Button type="submit" size="sm" variant="secondary" disabled={disabled || busyLink}>
            {busyLink ? "Adding…" : "Add"}
          </Button>
        </div>
      </form>
      <label
        htmlFor="upload-FIGMA"
        className={cn(
          "text-[13px] font-semibold underline",
          style.browse,
          disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
        )}
      >
        {busy ? "Uploading…" : "or upload exported PNG/JPG frames"}
        <input
          id="upload-FIGMA"
          type="file"
          multiple
          accept={info.accept}
          className="sr-only"
          disabled={disabled || busy}
          onChange={(e) => void upload(e.target.files)}
        />
      </label>
      {linkStatus && <div className="text-success text-[13px] font-semibold">{linkStatus}</div>}
      {uploaded > 0 && (
        <div className="text-success text-[13px] font-semibold">
          {plural(uploaded, "frame")} added
        </div>
      )}
    </Card>
  );
}

function CardTitleRow({
  Icon,
  iconBox,
  title,
  help,
}: {
  Icon: typeof DocumentIcon;
  iconBox: string;
  title: string;
  help: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", iconBox)}>
        <Icon size={20} />
      </div>
      <div className="flex flex-col">
        <h3 className="font-bold">{title}</h3>
        <div className="text-muted text-xs">{help}</div>
      </div>
    </div>
  );
}

function fileMeta(doc: DocumentItem): string {
  const parts: string[] = [];
  if (doc.sizeBytes != null) parts.push(formatBytes(doc.sizeBytes));
  if (doc.source === "LINK" && doc.pageCount != null) parts.push(plural(doc.pageCount, "screen"));
  else if (doc.pageCount != null && doc.pageCount > 1) parts.push(plural(doc.pageCount, "page"));
  if (doc.ocrUsed) parts.push("read with OCR");
  if (doc.derivedFromId) parts.push("from Figma link");
  return parts.join(" · ") || doc.uploadedBy.name;
}

function FileRow({
  doc,
  projectId,
  canWrite,
  onTag,
  onDelete,
  onRetry,
}: {
  doc: DocumentItem;
  projectId: string;
  canWrite: boolean;
  onTag: (t: DocumentTagName) => void;
  onDelete: () => void;
  onRetry: () => void;
}) {
  const status = STATUS_LABEL[doc.extractionStatus];
  const tagId = `tag-${doc.id}`;
  return (
    <li className="border-line-soft flex flex-wrap items-center gap-3.5 border-b px-5 py-3.5 last:border-b-0">
      <div className="bg-chip text-ink-2 flex size-10 shrink-0 items-center justify-center rounded-[10px] text-[11px] font-bold">
        {fileExt(doc)}
      </div>
      <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-0.5">
        <div className="truncate font-semibold">
          {doc.extractionStatus === "SUCCEEDED" ? (
            <Link
              href={`/projects/${projectId}/documents/${doc.id}`}
              className="text-ink no-underline hover:underline"
            >
              {doc.originalName}
            </Link>
          ) : (
            doc.originalName
          )}
        </div>
        <div className="text-muted text-[13px]">{fileMeta(doc)}</div>
        {doc.extractionError && (
          <div
            className={cn(
              "text-[13px]",
              doc.extractionStatus === "FAILED" ? "text-warn" : "text-muted",
            )}
          >
            {doc.extractionError}
          </div>
        )}
      </div>
      <label htmlFor={tagId} className="sr-only">
        File type for {doc.originalName}
      </label>
      <select
        id={tagId}
        value={doc.typeTag}
        disabled={!canWrite || doc.source === "LINK"}
        onChange={(e) => onTag(e.target.value as DocumentTagName)}
        className="border-control h-10 rounded-lg border bg-white px-3 text-sm disabled:opacity-70"
      >
        {DOCUMENT_TAGS.map((t) => (
          <option key={t} value={t}>
            {DOCUMENT_TAG_LABELS[t]}
          </option>
        ))}
      </select>
      <Badge tone={status.tone}>{status.label}</Badge>
      {canWrite && (
        <div className="flex gap-1">
          {doc.extractionStatus === "FAILED" && (
            <Button variant="ghost" size="sm" onClick={onRetry}>
              Try again
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            aria-label={`Remove ${doc.originalName}`}
          >
            Remove
          </Button>
        </div>
      )}
    </li>
  );
}
