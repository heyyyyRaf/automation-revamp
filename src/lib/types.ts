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

// ── Phase 3: environments, addresses, scripts, runs ───────────────────────────

export interface TargetItem {
  id: string;
  origin: string;
  allowPrivateNetwork: boolean;
  status: "PENDING" | "APPROVED" | "REVOKED";
  note: string | null;
  createdAt: DateLike;
  decidedAt: DateLike | null;
  requestedBy: { name: string };
  decidedBy: { name: string } | null;
  network: "public" | "private" | "blocked" | "unresolved";
  project?: { id: string; name: string } | null;
}

export interface LoginSettings {
  path: string;
  usernameLabel: string;
  passwordLabel: string;
  submitLabel: string;
  successText?: string | null;
  successUrlContains?: string | null;
}

export interface EnvironmentItem {
  id: string;
  name: string;
  baseUrl: string;
  shared: boolean;
  variables: { name: string; value: string }[];
  loginConfig: LoginSettings | null;
  verified: boolean;
  verifiedAt: DateLike | null;
  loginCheckStatus: "NOT_CHECKED" | "OK" | "FAILED";
  loginCheckedAt: DateLike | null;
  loginCheckError: string | null;
  hasSession: boolean;
  accounts: {
    id: string;
    label: string;
    usernameHint: string;
    isDefault: boolean;
    updatedAt: DateLike;
  }[];
  updatedAt: DateLike;
}

export type ScriptState = "NOT_GENERATED" | "NEEDS_EDIT" | "READY" | "EDITED" | "APPROVED";

export interface ScriptListItem {
  testCaseId: string;
  key: string;
  title: string;
  type: TestCaseTypeName;
  caseStatus: TestCaseStatusName;
  scenario: { id: string; key: string; title: string } | null;
  requirementKeys: string[];
  scriptId: string | null;
  state: ScriptState;
  version: number | null;
  missingSelectors: number;
  updatedAt: DateLike | null;
}

export interface ScriptChecksView {
  typeCheckOk: boolean;
  typeCheckLog: { line: number; message: string }[];
  safetyCheckOk: boolean;
  safetyIssues: { line: number; message: string }[];
  selectorCheck: {
    line: number;
    selector: string;
    status: "found" | "missing" | "unchecked";
    note: string | null;
  }[];
}

export interface ScriptDetailItem {
  id: string;
  startPath: string;
  needsEdit: boolean;
  status: "DRAFT" | "APPROVED" | "REJECTED";
  approvedVersionId: string | null;
  approvedBy: string | null;
  approvedAt: DateLike | null;
  environment: { id: string; name: string; baseUrl: string } | null;
  testCase: {
    id: string;
    key: string;
    title: string;
    type: TestCaseTypeName;
    status: TestCaseStatusName;
    requirementKeys: string[];
  };
  versions: {
    id: string;
    version: number;
    code: string;
    source: "AI_GENERATED" | "MANUAL_EDIT" | "AI_FIX";
    notes: string | null;
    createdBy: string | null;
    createdAt: DateLike;
    capturedFrom: string | null;
    checks: ScriptChecksView;
  }[];
}

export type RunStatusName =
  "QUEUED" | "RUNNING" | "PAUSED" | "PASSED" | "FAILED" | "ERROR" | "CANCELLED" | "ABORTED";
export type ResultStatusName = "PENDING" | "RUNNING" | "PASSED" | "FAILED" | "ERROR" | "SKIPPED";

export interface RunListItem {
  id: string;
  number: number;
  status: RunStatusName;
  environment: string;
  triggeredBy: string;
  total: number;
  passed: number;
  failed: number;
  errors: number;
  skipped: number;
  createdAt: DateLike;
  startedAt: DateLike | null;
  finishedAt: DateLike | null;
}

export interface RunStepItem {
  id: string;
  index: number;
  title: string;
  category: string | null;
  status: string;
  durationMs: number | null;
  error: string | null;
  hasScreenshot: boolean;
}

export interface RunTestItem {
  id: string;
  testCaseId: string;
  scriptId: string | null;
  key: string;
  title: string;
  status: ResultStatusName;
  attempts: number;
  durationMs: number | null;
  error: string | null;
  has: { trace: boolean; screenshot: boolean; log: boolean; console: boolean; network: boolean };
  steps: RunStepItem[];
}

export interface RunDetailItem {
  id: string;
  number: number;
  status: RunStatusName;
  error: string | null;
  environment: { id: string; name: string; baseUrl: string };
  triggeredBy: string;
  timeoutSeconds: number;
  retries: number;
  slowMotion: boolean;
  workers: number;
  createdAt: DateLike;
  startedAt: DateLike | null;
  finishedAt: DateLike | null;
  counts: { passed: number; failed: number; errors: number; skipped: number };
  tests: RunTestItem[];
}

/** Server-sent events of the Live Run view (mirror of server/runs/bus.ts). */
export type LiveEventItem =
  | {
      type: "run";
      status: RunStatusName;
      passed: number;
      failed: number;
      errors: number;
      skipped: number;
      error: string | null;
    }
  | {
      type: "test";
      runTestId: string;
      status: ResultStatusName;
      durationMs: number | null;
      error: string | null;
    }
  | { type: "step"; runTestId: string; step: RunStepItem }
  | { type: "step-begin"; runTestId: string; title: string; category: string }
  | { type: "frame"; runTestId: string; jpeg: string }
  | { type: "log"; runTestId: string | null; stream: "stdout" | "stderr"; text: string }
  | { type: "console"; runTestId: string; level: string; text: string }
  | {
      type: "net";
      runTestId: string;
      method: string;
      url: string;
      status: number | null;
      durationMs: number | null;
      failed: boolean;
    }
  | { type: "speed"; slow: boolean }
  | { type: "paused" }
  | { type: "resumed" }
  | { type: "end"; status: RunStatusName };

// ── Phase 4: reports, defects, share links, audit ──────────────────────────────

export type CoverageStatusName = "PASSING" | "FAILING" | "NOT_RUN" | "MANUAL" | "NOT_COVERED";
export type FailureCauseName = "APP_BUG" | "SCRIPT_ISSUE" | "ENVIRONMENT" | "UNKNOWN";
export type DefectSeverityName = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export type DefectStatusName = "OPEN" | "RESOLVED";

export interface CoverageData {
  total: number;
  covered: number;
  rows: {
    id: string;
    key: string;
    text: string;
    status: CoverageStatusName;
    cases: { key: string; automatable: boolean; latest: string | null }[];
  }[];
}

export interface ReportFailure {
  runTestId: string;
  testCaseId: string;
  key: string;
  title: string;
  requirementKeys: string[];
  status: "FAILED" | "ERROR";
  error: string | null;
  attempts: number;
  hasScreenshot: boolean;
  hasTrace: boolean;
  likelyCause: FailureCauseName | null;
  causeExplanation: string | null;
  defect: { id: string; key: string; status: DefectStatusName } | null;
}

/** FR-9.1 run report as the screens receive it (the public view has no base URL). */
export interface ReportData {
  project: { id: string; name: string };
  run: {
    id: string;
    number: number;
    status: RunStatusName;
    error: string | null;
    environment: string;
    triggeredBy: string;
    createdAt: DateLike;
    startedAt: DateLike | null;
    finishedAt: DateLike | null;
    durationMs: number | null;
    retries: number;
    timeoutSeconds: number;
  };
  totals: {
    automated: number;
    passed: number;
    failed: number;
    errors: number;
    skipped: number;
    manual: number;
    passRate: number | null;
  };
  failures: ReportFailure[];
  passedCases: { key: string; title: string; status: string; durationMs: number | null }[];
  manualCases: { id: string; key: string; title: string; automatableReason: string | null }[];
  coverage: CoverageData;
  analysis: { status: JobStatusName; error: string | null } | null;
}

export interface DefectItem {
  id: string;
  key: string;
  title: string;
  description: string;
  severity: DefectSeverityName;
  status: DefectStatusName;
  externalUrl: string | null;
  resolvedAt: DateLike | null;
  createdAt: DateLike;
  updatedAt: DateLike;
  createdBy: { name: string };
  testCase: { id: string; key: string; title: string } | null;
  runTest: { id: string; runId: string } | null;
}

export interface ShareItem {
  id: string;
  expiresAt: DateLike;
  createdAt: DateLike;
  createdBy: { name: string };
}

export interface AuditEntryItem {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: unknown;
  before: unknown;
  after: unknown;
  ipAddress: string | null;
  createdAt: DateLike;
  actor: { id: string; name: string } | null;
  project: { id: string; name: string } | null;
}
