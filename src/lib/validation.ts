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
