/** Client-safe document display helpers and types. */
import type { DocumentCategoryName } from "@/lib/validation";

export type ExtractionStatusName =
  "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "NOT_APPLICABLE";

export interface DocumentItem {
  id: string;
  category: DocumentCategoryName;
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
    help: "FRDs, user stories, acceptance criteria.",
    accept: ".pdf,.docx,.md,.markdown,.txt,.csv",
    types: "PDF, DOCX, MD, TXT, CSV",
  },
  SYSTEM_FLOW: {
    title: "System flow",
    help: "Flow charts and process diagrams.",
    accept: ".png,.jpg,.jpeg,.pdf",
    types: "PNG, JPG, PDF",
  },
  FIGMA: {
    title: "Figma designs",
    help: "Paste a Figma link or upload exported frames.",
    accept: ".png,.jpg,.jpeg",
    types: "PNG, JPG or a figma.com link",
  },
};

export const STATUS_LABEL: Record<
  ExtractionStatusName,
  { label: string; tone: "neutral" | "info" | "success" | "danger" }
> = {
  PENDING: { label: "Waiting to read", tone: "info" },
  PROCESSING: { label: "Reading text…", tone: "info" },
  SUCCEEDED: { label: "Text ready", tone: "success" },
  FAILED: { label: "Couldn't read", tone: "danger" },
  NOT_APPLICABLE: { label: "Saved", tone: "neutral" },
};

export function isInProgress(status: ExtractionStatusName): boolean {
  return status === "PENDING" || status === "PROCESSING";
}
