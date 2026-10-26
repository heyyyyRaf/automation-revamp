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
  | "targets:request"
  | "targets:approve"
  | "environments:manage"
  | "scripts:write"
  | "scripts:approve"
  | "runs:start"
  | "runs:control"
  | "comments:create"
  | "defects:write"
  | "reports:share"
  | "audit:read"
  | "settings:manage";

/** FRD roles table: "the QA Tester does almost everything". */
const TESTER: readonly Permission[] = [
  "projects:read",
  "projects:create",
  "projects:edit",
  "projects:archive",
  "comments:create",
  "documents:read",
  "documents:write",
  "requirements:write",
  "testcases:write",
  "testcases:review",
  "ai:run",
  "exports:create",
  "targets:request",
  "environments:manage",
  "scripts:write",
  "scripts:approve",
  "runs:start",
  "runs:control",
  "defects:write",
];

const MATRIX: Record<RoleName, readonly Permission[]> = {
  // Lead / Admin: everything a tester can, plus users, AI/model settings, the URL allowlist
  // and shared environments. Project owners may also manage their own project's members.
  ADMIN: [
    ...TESTER,
    "users:manage",
    "projects:manage-members",
    "targets:approve",
    "settings:manage",
    // FR-9.4 option (b): only the Lead can turn on a public, expiring report link.
    "reports:share",
    "audit:read",
  ],
  QA_TESTER: TESTER,
  // FRD: viewers see test cases and reports for their project and can comment.
  // Exporting the test scope only reads project data, so viewers may do it.
  VIEWER: ["projects:read", "documents:read", "exports:create", "comments:create"],
};

export function can(role: RoleName, permission: Permission): boolean {
  return MATRIX[role].includes(permission);
}
