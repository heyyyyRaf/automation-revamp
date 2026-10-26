/** Client-safe shapes of API responses. Dates arrive as ISO strings or Date objects. */
import type {
  PriorityName,
  RequirementTypeName,
  TestCaseStatusName,
  TestCaseTypeName,
} from "@/lib/domain";

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

/** While a job runs, its result carries a progress note ("Reading file 3 of 4"). */
export function jobNote(job: JobItem | null | undefined): { note?: string; etaSeconds?: number } {
  const r = job?.result as { note?: unknown; etaSeconds?: unknown } | null | undefined;
  return {
    ...(typeof r?.note === "string" ? { note: r.note } : {}),
    ...(typeof r?.etaSeconds === "number" ? { etaSeconds: r.etaSeconds } : {}),
  };
}

export interface AiBudgetItem {
  used: number;
  cap: number;
  remaining: number;
}

export type RequirementStatusName = "ACTIVE" | "NEEDS_REVIEW" | "MERGED";

export interface RequirementItem {
  id: string;
  key: string;
  text: string;
  type: RequirementTypeName;
  status: RequirementStatusName;
  origin: "AI" | "MANUAL";
  sourceSection: string | null;
  sourceDocument: { id: string; originalName: string; typeTag: string } | null;
  testCaseCount: number;
  approvedTestCaseCount: number;
  updatedBy: { id: string; name: string } | null;
  updatedAt: DateLike;
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
  requirement: {
    id: string;
    key: string;
    sourceSection: string | null;
    sourceDocument: { originalName: string } | null;
  } | null;
  answeredBy: { name: string } | null;
}

export interface ScenarioItem {
  id: string;
  key: string;
  title: string;
  description: string | null;
  flowSteps: string[];
  origin: "AI" | "MANUAL";
  testCaseCount: number;
  draftCount: number;
}

export interface TestCaseItem {
  id: string;
  key: string;
  title: string;
  scenario: { id: string; key: string; title: string } | null;
  preconditions: string | null;
  steps: { action: string; expected?: string | null }[];
  testData: { name: string; value: string }[];
  expectedResult: string;
  type: TestCaseTypeName;
  priority: PriorityName;
  automatable: boolean;
  automatableReason: string | null;
  tags: string[];
  origin: "AI" | "MANUAL";
  status: TestCaseStatusName;
  reviewedBy: string | null;
  reviewedAt: DateLike | null;
  rejectionReason: string | null;
  requirements: { id: string; key: string; text: string }[];
  sources: {
    requirementKey: string;
    document: string;
    documentId: string;
    section: string | null;
  }[];
  updatedBy: string | null;
  updatedAt: DateLike;
}

export interface CommentItem {
  id: string;
  body: string;
  author: { id: string; name: string; role: string };
  createdAt: DateLike;
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
