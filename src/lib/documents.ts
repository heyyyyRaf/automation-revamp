/** Client-safe document display helpers and types. */
import type { DocumentTagName } from "@/lib/domain";
import type { DocumentCategoryName } from "@/lib/validation";

export type ExtractionStatusName =
  "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "NOT_APPLICABLE";

export interface DocumentItem {
  id: string;
  category: DocumentCategoryName;
  typeTag: DocumentTagName;
  source: "FILE" | "LINK";
  originalName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  linkUrl: string | null;
  extractionStatus: ExtractionStatusName;
  extractionError: string | null;
  pageCount: number | null;
  ocrUsed: boolean;
  derivedFromId: string | null;
  createdAt: string | Date;
  uploadedBy: { id: string; name: string };
}

export const CATEGORY_INFO: Record<
  DocumentCategoryName,
  { title: string; help: string; accept: string; types: string }
> = {
  REQUIREMENTS: {
    title: "Requirements",
    help: "FRD, user stories, acceptance criteria",
    accept: ".pdf,.docx,.md,.markdown,.txt,.csv",
    types: "PDF, DOCX, MD, TXT, CSV",
  },
  SYSTEM_FLOW: {
    title: "System flow",
    help: "Flowcharts, process maps, diagrams",
    accept: ".png,.jpg,.jpeg,.pdf",
    types: "PNG, JPG, PDF",
  },
  FIGMA: {
    title: "Figma design",
    help: "Paste a link or upload frames",
    accept: ".png,.jpg,.jpeg",
    types: "PNG, JPG",
  },
};

/** File status chips from the design: Read · Reading… · Waiting · Needs attention. */
export const STATUS_LABEL: Record<
  ExtractionStatusName,
  { label: string; tone: "neutral" | "info" | "success" | "warning" }
> = {
  PENDING: { label: "Waiting", tone: "neutral" },
  PROCESSING: { label: "Reading…", tone: "info" },
  SUCCEEDED: { label: "Read", tone: "success" },
  FAILED: { label: "Needs attention", tone: "warning" },
  NOT_APPLICABLE: { label: "Saved", tone: "neutral" },
};

export function isInProgress(status: ExtractionStatusName): boolean {
  return status === "PENDING" || status === "PROCESSING";
}

/** "PDF", "MD", "PNG", "LINK" for the file badge. */
export function fileExt(doc: Pick<DocumentItem, "source" | "originalName">): string {
  if (doc.source === "LINK") return "LINK";
  const ext = /\.([a-z0-9]{1,5})$/i.exec(doc.originalName)?.[1];
  return ext ? ext.toUpperCase().replace("JPEG", "JPG") : "FILE";
}
