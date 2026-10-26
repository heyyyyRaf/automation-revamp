/** Client-safe domain vocabulary shared by the API, the AI tasks and the UI (FRD v0.1). */

/** FR-3.1: what a requirement describes. */
export const REQUIREMENT_TYPES = [
  "FEATURE",
  "USER_ACTION",
  "FIELD",
  "VALIDATION",
  "BUSINESS_RULE",
  "EXPECTED_RESULT",
  "FLOW",
  "NON_FUNCTIONAL",
  "OTHER",
] as const;
export type RequirementTypeName = (typeof REQUIREMENT_TYPES)[number];

export const REQUIREMENT_TYPE_LABELS: Record<RequirementTypeName, string> = {
  FEATURE: "Feature",
  USER_ACTION: "User action",
  FIELD: "Field",
  VALIDATION: "Validation",
  BUSINESS_RULE: "Business rule",
  EXPECTED_RESULT: "Expected result",
  FLOW: "Flow",
  NON_FUNCTIONAL: "Non-functional",
  OTHER: "Other",
};

/** FR-2.3: what a file is. Sent to the AI as context. */
export const DOCUMENT_TAGS = ["FRD", "USER_STORY", "FIGMA", "FLOW_DIAGRAM", "OTHER"] as const;
export type DocumentTagName = (typeof DOCUMENT_TAGS)[number];

export const DOCUMENT_TAG_LABELS: Record<DocumentTagName, string> = {
  FRD: "FRD",
  USER_STORY: "User stories",
  FIGMA: "Figma design",
  FLOW_DIAGRAM: "Flow diagram",
  OTHER: "Other",
};

/** FRD lifecycle: Draft → Approved → Scripted → Passed / Failed / Error. Rejected leaves the cycle. */
export const TEST_CASE_STATUSES = [
  "DRAFT",
  "APPROVED",
  "REJECTED",
  "SCRIPTED",
  "PASSED",
  "FAILED",
  "ERROR",
] as const;
export type TestCaseStatusName = (typeof TEST_CASE_STATUSES)[number];

export const TEST_CASE_STATUS_LABELS: Record<TestCaseStatusName, string> = {
  DRAFT: "Draft",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  SCRIPTED: "Scripted",
  PASSED: "Passed",
  FAILED: "Failed",
  ERROR: "Error",
};

/** Statuses that count as approved for scripting and running (FR-5.1). */
export const APPROVED_LIKE: readonly TestCaseStatusName[] = [
  "APPROVED",
  "SCRIPTED",
  "PASSED",
  "FAILED",
  "ERROR",
];

export const TEST_CASE_TYPES = ["POSITIVE", "NEGATIVE", "BOUNDARY"] as const;
export type TestCaseTypeName = (typeof TEST_CASE_TYPES)[number];
export const TEST_CASE_TYPE_LABELS: Record<TestCaseTypeName, string> = {
  POSITIVE: "Positive",
  NEGATIVE: "Negative",
  BOUNDARY: "Boundary",
};

export const PRIORITIES = ["HIGH", "MEDIUM", "LOW"] as const;
export type PriorityName = (typeof PRIORITIES)[number];

/** The 8 steps of the FRD system flow, as shown in the project progress bar. */
export const FLOW_STEPS = [
  "Upload",
  "Analyse",
  "Test cases",
  "Review",
  "Environment",
  "Scripts",
  "Run",
  "Report",
] as const;
