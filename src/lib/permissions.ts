/**
 * Role → permission matrix. Shared with the UI only to hide buttons;
 * the server enforces it on every route (see src/server/authz/guards.ts).
 */
export const ROLES = ["ADMIN", "QA_TESTER", "VIEWER"] as const;
export type RoleName = (typeof ROLES)[number];

export const ROLE_LABELS: Record<RoleName, string> = {
  ADMIN: "Admin / QA Lead",
  QA_TESTER: "QA Tester",
  VIEWER: "Viewer",
};

export type Permission =
  | "users:manage"
  | "projects:create"
  | "projects:archive"
  | "projects:manage-members"
  | "projects:read"
  | "projects:edit"
  | "documents:read"
  | "documents:write"
  | "requirements:write"
  | "testcases:write"
  | "testcases:review"
  | "ai:run"
  | "exports:create"
  | "targets:approve";

const TESTER: readonly Permission[] = [
  "projects:read",
  "documents:read",
  "documents:write",
  "requirements:write",
  "testcases:write",
  "testcases:review",
  "ai:run",
  "exports:create",
];

const MATRIX: Record<RoleName, readonly Permission[]> = {
  ADMIN: [
    ...TESTER,
    "users:manage",
    "projects:create",
    "projects:archive",
    "projects:manage-members",
    "projects:edit",
    "targets:approve",
  ],
  QA_TESTER: TESTER,
  // Exporting the test scope only reads project data, so viewers may do it.
  VIEWER: ["projects:read", "documents:read", "exports:create"],
};

export function can(role: RoleName, permission: Permission): boolean {
  return MATRIX[role].includes(permission);
}
