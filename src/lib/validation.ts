import { z } from "zod";
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

export const newPasswordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters.")
  .max(128, "Password must be at most 128 characters.");

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

export const createProjectSchema = z.object({
  name: trimmed(1, 120, "Project name"),
  description: z.string().trim().max(2000).optional(),
});

export const updateProjectSchema = z
  .object({
    name: trimmed(1, 120, "Project name").optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");

export const addMemberSchema = z.object({
  userId: z.string().regex(/^[a-z0-9]{20,40}$/, "Choose a user."),
});

export const DOCUMENT_CATEGORIES = ["REQUIREMENTS", "SYSTEM_FLOW", "FIGMA"] as const;
export const documentCategorySchema = z.enum(DOCUMENT_CATEGORIES);
export type DocumentCategoryName = z.infer<typeof documentCategorySchema>;

const FIGMA_HOSTS = new Set(["figma.com", "www.figma.com"]);

export const figmaLinkSchema = z.object({
  url: z
    .url({ protocol: /^https$/, message: "Enter an https:// Figma link." })
    .max(2048)
    .refine((u) => FIGMA_HOSTS.has(new URL(u).hostname), "Only figma.com links are allowed."),
  name: z.string().trim().max(200).optional(),
});

// ── Phase 2: requirements, questions, test cases, exports ─────────────────────

const ID = z.string().regex(/^[a-z0-9]{20,40}$/, "Invalid id.");

export const REQUIREMENT_TYPE_VALUES = [
  "FUNCTIONAL",
  "NON_FUNCTIONAL",
  "BUSINESS_RULE",
  "UI",
  "DATA",
  "SECURITY",
  "OTHER",
] as const;

export const requirementCreateSchema = z.object({
  text: trimmed(5, 2000, "Requirement"),
  type: z.enum(REQUIREMENT_TYPE_VALUES),
  sourceSection: z.string().trim().max(200).nullable().optional(),
});

export const requirementUpdateSchema = requirementCreateSchema
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

export const TEST_CASE_TYPE_VALUES = ["POSITIVE", "NEGATIVE", "BOUNDARY"] as const;
export const PRIORITY_VALUES = ["HIGH", "MEDIUM", "LOW"] as const;

export const testStepSchema = z.object({
  action: trimmed(1, 1000, "Step"),
  expected: z.string().trim().max(1000).nullable().optional(),
});

export const testCaseCreateSchema = z.object({
  title: trimmed(5, 200, "Title"),
  preconditions: z.string().trim().max(2000).nullable().optional(),
  steps: z.array(testStepSchema).min(1, "Add at least one step.").max(30),
  testData: z
    .array(z.object({ name: trimmed(1, 100, "Name"), value: z.string().max(500) }))
    .max(30)
    .optional(),
  expectedResult: trimmed(1, 2000, "Expected result"),
  type: z.enum(TEST_CASE_TYPE_VALUES),
  priority: z.enum(PRIORITY_VALUES),
  automatable: z.boolean(),
  automatableReason: z.string().trim().max(500).nullable().optional(),
  requirementIds: z.array(ID).min(1, "Link at least one requirement.").max(20),
});

export const testCaseUpdateSchema = testCaseCreateSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");

export const testCaseReviewSchema = z
  .object({
    testCaseIds: z.array(ID).min(1).max(200),
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

export const EXPORT_FORMATS = ["PDF", "XLSX", "DOCX"] as const;
export const exportCreateSchema = z.object({ format: z.enum(EXPORT_FORMATS) });

export const aiBudgetSchema = z.object({
  monthlyTokenCap: z.number().int().min(1000).max(1_000_000_000).nullable(),
});
