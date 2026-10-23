/** Client-safe shapes of API responses (Phase 2). Dates arrive as ISO strings or Date objects. */
export type DateLike = string | Date;

export type JobStatusName = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";

export interface JobItem {
  id: string;
  type: string;
  status: JobStatusName;
  progress: number;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  result: unknown;
  createdAt: DateLike;
  startedAt: DateLike | null;
  finishedAt: DateLike | null;
}

export function isJobActive(job: JobItem | null | undefined): boolean {
  return job?.status === "QUEUED" || job?.status === "RUNNING";
}

export interface AiBudgetItem {
  used: number;
  cap: number;
  remaining: number;
}

export interface RequirementItem {
  id: string;
  key: string;
  text: string;
  type: string;
  origin: "AI" | "MANUAL";
  sourceSection: string | null;
  sourceDocument: { id: string; originalName: string } | null;
  testCaseCount: number;
  approvedTestCaseCount: number;
}

export interface FlowItem {
  id: string;
  name: string;
  description: string | null;
  steps: string[];
  origin: "AI" | "MANUAL";
}

export interface QuestionItem {
  id: string;
  question: string;
  answer: string | null;
  status: "OPEN" | "ANSWERED" | "DISMISSED";
  origin: "AI" | "MANUAL";
  requirement: { id: string; key: string } | null;
  answeredBy: { name: string } | null;
}

export interface TestCaseItem {
  id: string;
  key: string;
  title: string;
  preconditions: string | null;
  steps: { action: string; expected?: string | null }[];
  testData: { name: string; value: string }[];
  expectedResult: string;
  type: "POSITIVE" | "NEGATIVE" | "BOUNDARY";
  priority: "HIGH" | "MEDIUM" | "LOW";
  automatable: boolean;
  automatableReason: string | null;
  origin: "AI" | "MANUAL";
  status: "DRAFT" | "APPROVED" | "REJECTED";
  reviewedBy: string | null;
  reviewedAt: DateLike | null;
  rejectionReason: string | null;
  requirements: { id: string; key: string; text: string }[];
}

export interface ExportItem {
  id: string;
  format: "PDF" | "XLSX" | "DOCX" | "HTML" | "ZIP";
  status: JobStatusName;
  fileName: string | null;
  error: string | null;
  createdAt: DateLike;
  createdBy: { name: string };
}

export const REQUIREMENT_TYPE_LABELS: Record<string, string> = {
  FUNCTIONAL: "Functional",
  NON_FUNCTIONAL: "Non-functional",
  BUSINESS_RULE: "Business rule",
  UI: "UI",
  DATA: "Data",
  SECURITY: "Security",
  OTHER: "Other",
};
