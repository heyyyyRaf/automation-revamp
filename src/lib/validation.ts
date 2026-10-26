import { z } from "zod";
import { DOCUMENT_TAGS, PRIORITIES, REQUIREMENT_TYPES, TEST_CASE_TYPES } from "@/lib/domain";
import { ROLES } from "@/lib/permissions";

const trimmed = (min: number, max: number, label: string) =>
  z
    .string()
    .trim()
    .min(min, `${label} is required.`)
    .max(max, `${label} must be at most ${max} characters.`);

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email("Enter a valid email address."));

/** Shown next to every "new password" field. */
export const PASSWORD_RULES =
  "At least 8 characters, with a capital letter, a number and a special character.";

export const newPasswordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(128, "Password must be at most 128 characters.")
  .regex(/\p{Lu}/u, "Add at least one capital letter.")
  .regex(/\p{Nd}/u, "Add at least one number.")
  .regex(/[^\p{L}\p{N}\s]/u, "Add at least one special character, such as ! ? # or @.");

/** Settings → Your account: change your own password. */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password.").max(128),
    newPassword: newPasswordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: "Choose a password different from your current one.",
    path: ["newPassword"],
  });

export const loginSchema = z.object({
  email: emailSchema,
  // No complexity rules on login — just bound the size before hashing.
  password: z.string().min(1, "Enter your password.").max(128),
});

export const roleSchema = z.enum(ROLES);

export const createUserSchema = z.object({
  email: emailSchema,
  name: trimmed(1, 100, "Name"),
  role: roleSchema,
  password: newPasswordSchema,
});

export const updateUserSchema = z
  .object({
    name: trimmed(1, 100, "Name").optional(),
    role: roleSchema.optional(),
    isActive: z.boolean().optional(),
    password: newPasswordSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");

const ID = z.string().regex(/^[a-z0-9]{20,40}$/, "Invalid id.");

/** FR-1.1: name, description, owner. The owner defaults to the creator. */
export const createProjectSchema = z.object({
  name: trimmed(1, 120, "Project name"),
  description: z.string().trim().max(2000).optional(),
  ownerId: ID.optional(),
});

export const updateProjectSchema = z
  .object({
    name: trimmed(1, 120, "Project name").optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    ownerId: ID.optional(),
    status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");

export const addMemberSchema = z.object({
  userId: z.string().regex(/^[a-z0-9]{20,40}$/, "Choose a user."),
});

export const DOCUMENT_CATEGORIES = ["REQUIREMENTS", "SYSTEM_FLOW", "FIGMA"] as const;
export const documentCategorySchema = z.enum(DOCUMENT_CATEGORIES);
export type DocumentCategoryName = z.infer<typeof documentCategorySchema>;

export const documentTagSchema = z.enum(DOCUMENT_TAGS);
export const documentUpdateSchema = z.object({ typeTag: documentTagSchema });

const FIGMA_HOSTS = new Set(["figma.com", "www.figma.com"]);

export const figmaLinkSchema = z.object({
  url: z
    .url({ protocol: /^https$/, message: "Enter an https:// Figma link." })
    .max(2048)
    .refine((u) => FIGMA_HOSTS.has(new URL(u).hostname), "Only figma.com links are allowed."),
  name: z.string().trim().max(200).optional(),
});

// ── Phase 2: requirements, questions, scenarios, test cases, exports ──────────

export const requirementCreateSchema = z.object({
  text: trimmed(5, 2000, "Requirement"),
  type: z.enum(REQUIREMENT_TYPES),
  sourceSection: z.string().trim().max(200).nullable().optional(),
});

export const requirementUpdateSchema = requirementCreateSchema
  .extend({ status: z.enum(["ACTIVE", "NEEDS_REVIEW"]) })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");

/** FR-3.4: merge several requirements into one; links and questions move to the result. */
export const requirementMergeSchema = z.object({
  requirementIds: z.array(ID).min(2, "Choose at least two requirements.").max(20),
  text: trimmed(5, 2000, "Merged requirement"),
  type: z.enum(REQUIREMENT_TYPES),
});

export const scenarioCreateSchema = z.object({
  title: trimmed(3, 200, "Scenario title"),
  description: z.string().trim().max(2000).nullable().optional(),
  flowSteps: z
    .array(trimmed(1, 500, "Step"))
    .max(40)
    .optional(),
});

export const scenarioUpdateSchema = scenarioCreateSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");

export const flowCreateSchema = z.object({
  name: trimmed(1, 200, "Flow name"),
  description: z.string().trim().max(2000).nullable().optional(),
  steps: z
    .array(trimmed(1, 500, "Step"))
    .min(1, "Add at least one step.")
    .max(40),
});

export const flowUpdateSchema = flowCreateSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");

export const questionCreateSchema = z.object({
  question: trimmed(5, 1000, "Question"),
  requirementId: ID.nullable().optional(),
});

export const questionUpdateSchema = z
  .object({
    answer: trimmed(1, 4000, "Answer").optional(),
    status: z.enum(["OPEN", "DISMISSED"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");

export const TEST_CASE_TYPE_VALUES = TEST_CASE_TYPES;
export const PRIORITY_VALUES = PRIORITIES;

export const testStepSchema = z.object({
  action: trimmed(1, 1000, "Step"),
  expected: z.string().trim().max(1000).nullable().optional(),
});

const TAG = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9 _-]{0,29}$/, "Tags use letters, digits, spaces, - or _ (max 30).");

/**
 * FR-4.3: every case has ID, title, preconditions, steps, test data, expected result, priority,
 * type and linked requirement(s) — "no case is saved with a missing field".
 */
export const testCaseCreateSchema = z.object({
  title: trimmed(5, 200, "Title"),
  scenarioId: ID,
  preconditions: trimmed(1, 2000, "Preconditions"),
  steps: z.array(testStepSchema).min(1, "Add at least one step.").max(30),
  testData: z
    .array(z.object({ name: trimmed(1, 100, "Name"), value: trimmed(1, 500, "Value") }))
    .min(1, "Add at least one test data value (use “none” if nothing is needed).")
    .max(30),
  expectedResult: trimmed(1, 2000, "Expected result"),
  type: z.enum(TEST_CASE_TYPES),
  priority: z.enum(PRIORITIES),
  automatable: z.boolean(),
  automatableReason: trimmed(1, 500, "Reason"),
  requirementIds: z.array(ID).min(1, "Link at least one requirement.").max(20),
  tags: z.array(TAG).max(10).optional(),
});

export const testCaseUpdateSchema = testCaseCreateSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");

export const testCaseReviewSchema = z
  .object({
    testCaseIds: z.array(ID).min(1).max(500),
    decision: z.enum(["APPROVE", "REJECT", "REOPEN"]),
    reason: z.string().trim().max(1000).optional(),
  })
  .refine((v) => v.decision !== "REJECT" || (v.reason?.length ?? 0) > 0, {
    message: "Say why the test case is rejected.",
    path: ["reason"],
  });

export const generateTestCasesSchema = z.object({
  requirementIds: z.array(ID).max(300).optional(),
});

/** FR-4.5 / design: rewrite one case with an instruction; the result is a proposal to accept. */
export const testCaseRewriteSchema = z.object({
  instruction: trimmed(3, 1000, "Instruction"),
});

export const applyRewriteSchema = z.object({ jobId: ID });

export const regenerateSchema = z.object({ testCaseIds: z.array(ID).max(200).optional() });

export const testCaseExportSchema = z.object({ format: z.enum(["csv", "xlsx"]) });

export const commentCreateSchema = z.object({
  targetType: z.enum(["TEST_CASE", "RUN"]),
  targetId: ID,
  body: trimmed(1, 4000, "Comment"),
});

/** Lead-managed AI settings (the API key itself is never stored here). */
export const analysisRetrySchema = z.object({ retryJobId: ID.optional() });

export const aiSettingsSchema = z.object({
  model: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._:-]{2,80}$/, "Enter a model name like gpt-5.5.")
    .nullable()
    .optional(),
  defaultMonthlyTokenCap: z.number().int().min(1000).max(1_000_000_000).nullable().optional(),
});

export const EXPORT_FORMATS = ["PDF", "XLSX", "DOCX"] as const;
export const exportCreateSchema = z.object({ format: z.enum(EXPORT_FORMATS) });

export const aiBudgetSchema = z.object({
  monthlyTokenCap: z.number().int().min(1000).max(1_000_000_000).nullable(),
});

// ── Phase 3: targets, environments, scripts, runs ─────────────────────────────

export const targetRequestSchema = z.object({
  url: z.url({ protocol: /^https?$/, message: "Enter an http:// or https:// address." }).max(500),
  note: z.string().trim().max(500).optional(),
});

/** The Lead adds an approved address for shared environments (NFR-3). */
export const globalTargetSchema = z.object({
  url: z.url({ protocol: /^https?$/, message: "Enter an http:// or https:// address." }).max(500),
  allowPrivateNetwork: z.boolean().default(false),
  note: z.string().trim().max(500).optional(),
});

export const targetDecisionSchema = z.object({
  decision: z.enum(["APPROVE", "REVOKE"]),
  allowPrivateNetwork: z.boolean().default(false),
  note: z.string().trim().max(500).optional(),
});

const VAR_NAME = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]{0,49}$/, "Use CAPITALS, digits and _ (e.g. SHOP_NAME).");

export const loginSettingsSchema = z.object({
  path: z.string().trim().startsWith("/", "Start with /").max(500),
  usernameLabel: trimmed(1, 100, "Username field label"),
  passwordLabel: trimmed(1, 100, "Password field label"),
  submitLabel: trimmed(1, 100, "Sign-in button text"),
  successText: z.string().trim().max(200).nullable().optional(),
  successUrlContains: z.string().trim().max(200).nullable().optional(),
});

export const environmentCreateSchema = z.object({
  name: trimmed(1, 60, "Name"),
  targetId: ID,
  basePath: z
    .string()
    .trim()
    .max(300)
    .regex(/^(\/[^\s?#]*)?$/, "Use a path like /app, or leave empty.")
    .optional(),
  variables: z
    .array(z.object({ name: VAR_NAME, value: z.string().max(1000) }))
    .max(50)
    .optional(),
  loginConfig: loginSettingsSchema.nullable().optional(),
});

export const environmentUpdateSchema = environmentCreateSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");

export const accountCreateSchema = z.object({
  label: trimmed(1, 60, "Label"),
  username: z.string().min(1, "Username is required.").max(254),
  password: z.string().min(1, "Password is required.").max(256),
  isDefault: z.boolean().optional(),
});

export const accountUpdateSchema = z
  .object({
    label: trimmed(1, 60, "Label").optional(),
    username: z.string().min(1).max(254).optional(),
    password: z.string().min(1).max(256).optional(),
    isDefault: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");

/** FR-6.1: scripts for the chosen approved, automatable cases (default: all without one). */
export const scriptGenerateSchema = z.object({
  testCaseIds: z.array(ID).min(1).max(200).optional(),
  environmentId: ID,
  startPath: z.string().trim().startsWith("/", "Start with /").max(500).default("/"),
});

/** FR-6.3: the tester's edited script becomes a new version. */
export const scriptVersionCreateSchema = z.object({
  code: z.string().min(1).max(100_000),
});

/** Design "Ask AI to fix": optional instruction and/or a failed run to learn from. */
export const scriptFixSchema = z.object({
  instruction: z.string().trim().max(2000).optional(),
  runTestId: ID.optional(),
});

export const scriptApproveSchema = z.object({
  versionId: ID,
  decision: z.enum(["APPROVE", "REVOKE"]).default("APPROVE"),
});

/** FR-8.1: which approved, scripted cases to run. */
export const runSelectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("all") }),
  z.object({ kind: z.literal("scenario"), scenarioId: ID }),
  z.object({ kind: z.literal("tag"), tag: TAG }),
  z.object({ kind: z.literal("cases"), testCaseIds: z.array(ID).min(1).max(500) }),
]);

export const runCreateSchema = z.object({
  environmentId: ID,
  selection: runSelectionSchema.default({ kind: "all" }),
  /** FR-8.4: per-test timeout and retry count. */
  timeoutSeconds: z.coerce.number().int().min(10).max(600).default(120),
  retries: z.coerce.number().int().min(0).max(3).default(0),
  /** Design "Slow motion": start the run slowed down. */
  slowMotion: z.boolean().default(false),
});

/** Design "Re-run N failed": all failures of the run, or the chosen ones. */
export const rerunSchema = z.object({
  testCaseIds: z.array(ID).min(1).max(500).optional(),
});

export const reportExportSchema = z.object({ format: z.enum(["PDF", "HTML"]) });

export const DEFECT_SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
export const DEFECT_STATUSES = ["OPEN", "RESOLVED"] as const;

/** Where the defect was filed outside, if anywhere: http(s) links only. */
const externalUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => {
    if (v === "") return true;
    try {
      const u = new URL(v);
      return u.protocol === "https:" || u.protocol === "http:";
    } catch {
      return false;
    }
  }, "Enter a link that starts with https://.")
  .transform((v) => (v === "" ? null : v));

/** FRD step 7: log a failed case as a defect (manual in v1). */
export const defectCreateSchema = z.object({
  title: trimmed(1, 200, "Title"),
  description: z.string().trim().max(10_000).default(""),
  severity: z.enum(DEFECT_SEVERITIES).default("MEDIUM"),
  externalUrl: externalUrl.nullable().optional(),
  runTestId: ID.optional(),
  testCaseId: ID.optional(),
});

export const defectUpdateSchema = z
  .object({
    title: trimmed(1, 200, "Title").optional(),
    description: z.string().trim().max(10_000).optional(),
    severity: z.enum(DEFECT_SEVERITIES).optional(),
    status: z.enum(DEFECT_STATUSES).optional(),
    externalUrl: externalUrl.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to change.");

/** FR-9.4 option (b): public link lifetime. */
export const SHARE_DAYS = [1, 7, 30] as const;
export const shareCreateSchema = z.object({
  days: z.union([z.literal(1), z.literal(7), z.literal(30)]).default(7),
});

export const runControlSchema = z.object({
  action: z.enum(["pause", "resume", "stop", "slow", "normal"]),
});
