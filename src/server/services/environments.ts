import type { z } from "zod";
import type { Environment, Prisma } from "@/generated/prisma/client";
import type {
  accountCreateSchema,
  accountUpdateSchema,
  environmentCreateSchema,
  environmentUpdateSchema,
} from "@/lib/validation";
import type { AuthContext } from "@/server/auth/session";
import { isValidId, requirePermission, requireProjectAccess } from "@/server/authz/guards";
import { decryptBuffer, decryptString, encryptString, maskUsername } from "@/server/crypto/secrets";
import { db } from "@/server/db";
import { badRequest, conflict, notFound } from "@/server/errors";
import { enqueueJob } from "@/server/jobs/enqueue";
import { loginConfigSchema, type LoginConfig } from "@/server/sandbox/protocol";
import { audit } from "@/server/services/audit";
import { requireApprovedTarget } from "@/server/services/targets";
import { getStorage } from "@/server/storage/storage";

interface Meta {
  ip: string;
  requestId: string;
}

/**
 * Where an environment lives: inside a project (testers manage it) or shared by every
 * project (the Lead manages it — user decision 2026-10-23).
 */
export type EnvScope = { projectId: string } | { shared: true };

const scopeProjectId = (scope: EnvScope): string | null =>
  "projectId" in scope ? scope.projectId : null;

/** Read = see it; write = change it. A shared environment is changed only by the Lead. */
async function requireScope(auth: AuthContext, scope: EnvScope, write: boolean): Promise<void> {
  if ("projectId" in scope) {
    await requireProjectAccess(
      auth,
      scope.projectId,
      write ? "environments:manage" : "projects:read",
    );
  } else {
    requirePermission(auth, write ? "settings:manage" : "projects:read");
  }
}

function variablesToObject(
  vars: { name: string; value: string }[] | undefined,
): Record<string, string> {
  return Object.fromEntries((vars ?? []).map((v) => [v.name, v.value]));
}

type EnvWithAccounts = Environment & {
  accounts: {
    id: string;
    label: string;
    usernameHint: string;
    isDefault: boolean;
    updatedAt: Date;
  }[];
};

/** Public shape: never includes credentials — only masked usernames. */
function toDto(env: EnvWithAccounts) {
  return {
    id: env.id,
    name: env.name,
    baseUrl: env.baseUrl,
    shared: env.projectId === null,
    variables: Object.entries((env.variables as Record<string, string> | null) ?? {}).map(
      ([name, value]) => ({ name, value: String(value) }),
    ),
    loginConfig: loginConfigSchema.safeParse(env.loginConfig).data ?? null,
    /** FRD: "Unverified" until a check passes; runs are blocked until then. */
    verified: env.verifiedAt !== null,
    verifiedAt: env.verifiedAt,
    loginCheckStatus: env.loginCheckStatus,
    loginCheckedAt: env.loginCheckedAt,
    loginCheckError: env.loginCheckError,
    hasSession: Boolean(env.storageStateKey),
    accounts: env.accounts.map((a) => ({
      id: a.id,
      label: a.label,
      usernameHint: a.usernameHint,
      isDefault: a.isDefault,
      updatedAt: a.updatedAt,
    })),
    updatedAt: env.updatedAt,
  };
}

export type EnvironmentDto = ReturnType<typeof toDto>;

const ACCOUNT_SELECT = {
  id: true,
  label: true,
  usernameHint: true,
  isDefault: true,
  updatedAt: true,
} as const;

const WITH_ACCOUNTS = {
  accounts: { select: ACCOUNT_SELECT, orderBy: { label: "asc" } },
} satisfies Prisma.EnvironmentInclude;

/** A project's own environments plus the shared ones, which every project may use. */
export async function listEnvironments(
  auth: AuthContext,
  projectId: string,
): Promise<EnvironmentDto[]> {
  await requireProjectAccess(auth, projectId, "projects:read");
  const rows = await db.environment.findMany({
    where: { OR: [{ projectId }, { projectId: null }] },
    orderBy: [{ projectId: { sort: "asc", nulls: "last" } }, { name: "asc" }],
    include: WITH_ACCOUNTS,
  });
  return rows.map(toDto);
}

export async function listSharedEnvironments(auth: AuthContext): Promise<EnvironmentDto[]> {
  requirePermission(auth, "projects:read");
  const rows = await db.environment.findMany({
    where: { projectId: null },
    orderBy: { name: "asc" },
    include: WITH_ACCOUNTS,
  });
  return rows.map(toDto);
}

/** The environment in exactly this scope (for changes). */
export async function findEnvironment(scope: EnvScope | string, environmentId: string) {
  const projectId = typeof scope === "string" ? scope : scopeProjectId(scope);
  if (!isValidId(environmentId)) throw notFound("Environment");
  const env = await db.environment.findFirst({ where: { id: environmentId, projectId } });
  if (!env) throw notFound("Environment");
  return env;
}

/** An environment a project may use: its own or a shared one (for runs and scripts). */
export async function findUsableEnvironment(projectId: string, environmentId: string) {
  if (!isValidId(environmentId)) throw notFound("Environment");
  const env = await db.environment.findFirst({
    where: { id: environmentId, OR: [{ projectId }, { projectId: null }] },
  });
  if (!env) throw notFound("Environment");
  return env;
}

async function baseUrlFor(
  projectId: string | null,
  targetId: string,
  basePath: string | undefined,
): Promise<string> {
  if (!isValidId(targetId)) throw notFound("Address");
  const target = await db.allowedTarget.findFirst({ where: { id: targetId, projectId } });
  if (!target) throw notFound("Address");
  if (target.status !== "APPROVED") throw conflict("Choose an address the Lead has approved.");
  return `${target.origin}${basePath && basePath !== "/" ? basePath.replace(/\/$/, "") : ""}`;
}

/** A change to how the app is reached or signed into makes the environment Unverified. */
const UNVERIFY = {
  verifiedAt: null,
  loginCheckStatus: "NOT_CHECKED",
  loginCheckError: null,
} as const;

async function dropSession(env: Environment): Promise<void> {
  if (env.storageStateKey) {
    await getStorage()
      .delete(env.storageStateKey)
      .catch(() => undefined);
  }
}

export async function createEnvironment(
  auth: AuthContext,
  scope: EnvScope,
  input: z.infer<typeof environmentCreateSchema>,
  meta: Meta,
) {
  await requireScope(auth, scope, true);
  const projectId = scopeProjectId(scope);
  const baseUrl = await baseUrlFor(projectId, input.targetId, input.basePath);
  const exists = await db.environment.findFirst({ where: { projectId, name: input.name } });
  if (exists) throw conflict("An environment with this name already exists.");
  const env = await db.environment.create({
    data: {
      projectId,
      name: input.name,
      baseUrl,
      variables: variablesToObject(input.variables),
      loginConfig: (input.loginConfig ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
  await audit({
    action: "environment.create",
    entityType: "environment",
    entityId: env.id,
    projectId,
    actorId: auth.user.id,
    metadata: { name: env.name, baseUrl, shared: projectId === null },
    after: { name: env.name, baseUrl },
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });
  return env;
}

export async function updateEnvironment(
  auth: AuthContext,
  scope: EnvScope,
  environmentId: string,
  input: z.infer<typeof environmentUpdateSchema>,
  meta: Meta,
) {
  await requireScope(auth, scope, true);
  const projectId = scopeProjectId(scope);
  const env = await findEnvironment(scope, environmentId);
  const data: Prisma.EnvironmentUncheckedUpdateInput = {};
  if (input.name !== undefined && input.name !== env.name) {
    if (await db.environment.findFirst({ where: { projectId, name: input.name } })) {
      throw conflict("An environment with this name already exists.");
    }
    data.name = input.name;
  }
  if (input.variables !== undefined) data.variables = variablesToObject(input.variables);
  if (input.loginConfig !== undefined) {
    data.loginConfig = (input.loginConfig ?? undefined) as Prisma.InputJsonValue | undefined;
  }
  if (input.targetId !== undefined) {
    data.baseUrl = await baseUrlFor(projectId, input.targetId, input.basePath);
  }
  const unverify =
    (data.baseUrl !== undefined && data.baseUrl !== env.baseUrl) || input.loginConfig !== undefined;
  if (unverify) Object.assign(data, UNVERIFY, { storageStateKey: null });
  const updated = await db.environment.update({ where: { id: env.id }, data });
  if (unverify) await dropSession(env);
  await audit({
    action: "environment.update",
    entityType: "environment",
    entityId: env.id,
    projectId,
    actorId: auth.user.id,
    metadata: { fields: Object.keys(input) },
    before: { name: env.name, baseUrl: env.baseUrl },
    after: { name: updated.name, baseUrl: updated.baseUrl },
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });
  return updated;
}

export async function deleteEnvironment(
  auth: AuthContext,
  scope: EnvScope,
  environmentId: string,
  meta: Meta,
) {
  await requireScope(auth, scope, true);
  const env = await findEnvironment(scope, environmentId);
  if (await db.run.count({ where: { environmentId: env.id } })) {
    throw conflict("This environment has run history and can't be deleted.");
  }
  await db.environment.delete({ where: { id: env.id } });
  await dropSession(env);
  await audit({
    action: "environment.delete",
    entityType: "environment",
    entityId: env.id,
    projectId: env.projectId,
    actorId: auth.user.id,
    metadata: { name: env.name },
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });
}

// ── Test accounts (credentials encrypted at rest, write-only through the API) ─

export async function addAccount(
  auth: AuthContext,
  scope: EnvScope,
  environmentId: string,
  input: z.infer<typeof accountCreateSchema>,
  meta: Meta,
) {
  await requireScope(auth, scope, true);
  const env = await findEnvironment(scope, environmentId);
  const exists = await db.testAccount.findUnique({
    where: { environmentId_label: { environmentId: env.id, label: input.label } },
  });
  if (exists) throw conflict("An account with this label already exists.");
  const first = (await db.testAccount.count({ where: { environmentId: env.id } })) === 0;
  const isDefault = input.isDefault ?? first;
  const account = await db.$transaction(async (tx) => {
    if (isDefault) {
      await tx.testAccount.updateMany({
        where: { environmentId: env.id },
        data: { isDefault: false },
      });
    }
    const created = await tx.testAccount.create({
      data: {
        environmentId: env.id,
        label: input.label,
        usernameEncrypted: encryptString(input.username),
        passwordEncrypted: encryptString(input.password),
        usernameHint: maskUsername(input.username),
        isDefault,
      },
      select: ACCOUNT_SELECT,
    });
    // A new sign-in account means the saved session no longer proves anything.
    if (isDefault) {
      await tx.environment.update({
        where: { id: env.id },
        data: { ...UNVERIFY, storageStateKey: null },
      });
    }
    return created;
  });
  if (isDefault) await dropSession(env);
  await audit({
    action: "account.create",
    entityType: "test_account",
    entityId: account.id,
    projectId: env.projectId,
    actorId: auth.user.id,
    metadata: { environmentId: env.id, label: account.label }, // never the credentials
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });
  return account;
}

async function findAccount(environmentId: string, accountId: string) {
  if (!isValidId(accountId)) throw notFound("Account");
  const account = await db.testAccount.findFirst({ where: { id: accountId, environmentId } });
  if (!account) throw notFound("Account");
  return account;
}

export async function updateAccount(
  auth: AuthContext,
  scope: EnvScope,
  environmentId: string,
  accountId: string,
  input: z.infer<typeof accountUpdateSchema>,
  meta: Meta,
) {
  await requireScope(auth, scope, true);
  const env = await findEnvironment(scope, environmentId);
  const account = await findAccount(env.id, accountId);
  const data: Prisma.TestAccountUpdateInput = {};
  if (input.label !== undefined) data.label = input.label;
  if (input.username !== undefined) {
    data.usernameEncrypted = encryptString(input.username);
    data.usernameHint = maskUsername(input.username);
  }
  if (input.password !== undefined) data.passwordEncrypted = encryptString(input.password);
  if (input.isDefault !== undefined) data.isDefault = input.isDefault;
  const credentialsChanged =
    (account.isDefault || input.isDefault === true) &&
    (input.username !== undefined || input.password !== undefined || input.isDefault === true);
  const updated = await db.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.testAccount.updateMany({
        where: { environmentId: env.id },
        data: { isDefault: false },
      });
    }
    const row = await tx.testAccount.update({
      where: { id: account.id },
      data,
      select: ACCOUNT_SELECT,
    });
    if (credentialsChanged) {
      await tx.environment.update({
        where: { id: env.id },
        data: { ...UNVERIFY, storageStateKey: null },
      });
    }
    return row;
  });
  if (credentialsChanged) await dropSession(env);
  await audit({
    action: "account.update",
    entityType: "test_account",
    entityId: account.id,
    projectId: env.projectId,
    actorId: auth.user.id,
    metadata: { fields: Object.keys(input) }, // field names only, never values
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });
  return updated;
}

export async function deleteAccount(
  auth: AuthContext,
  scope: EnvScope,
  environmentId: string,
  accountId: string,
  meta: Meta,
) {
  await requireScope(auth, scope, true);
  const env = await findEnvironment(scope, environmentId);
  const account = await findAccount(env.id, accountId);
  await db.testAccount.delete({ where: { id: account.id } });
  if (account.isDefault) {
    await db.environment.update({
      where: { id: env.id },
      data: { ...UNVERIFY, storageStateKey: null },
    });
    await dropSession(env);
  }
  await audit({
    action: "account.delete",
    entityType: "test_account",
    entityId: account.id,
    projectId: env.projectId,
    actorId: auth.user.id,
    metadata: { label: account.label },
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });
}

/**
 * FRD step 5: test the environment once and save the session. With sign-in settings, signs
 * in with the default account; without, checks the start page opens. A shared environment
 * is checked from the project that wants to use it (the job belongs to that project).
 */
export async function verifyEnvironment(
  auth: AuthContext,
  projectId: string,
  environmentId: string,
  meta: Meta,
) {
  await requireProjectAccess(auth, projectId, "environments:manage");
  const env = await findUsableEnvironment(projectId, environmentId);
  await requireApprovedTarget(env.projectId, env.baseUrl);
  const hasLogin = loginConfigSchema.safeParse(env.loginConfig).success;
  if (
    hasLogin &&
    !(await db.testAccount.findFirst({ where: { environmentId: env.id, isDefault: true } }))
  ) {
    throw badRequest("Add a test account and mark one as default first.");
  }
  const running = await db.job.findFirst({
    where: {
      type: "VERIFY_LOGIN",
      status: { in: ["QUEUED", "RUNNING"] },
      payload: { path: ["environmentId"], equals: env.id },
    },
  });
  if (running) throw conflict("This environment is already being checked.");
  await db.environment.update({
    where: { id: env.id },
    data: { loginCheckError: "Checking…" },
  });
  const job = await enqueueJob({
    projectId,
    type: "VERIFY_LOGIN",
    payload: { environmentId: env.id },
    createdById: auth.user.id,
    maxAttempts: 1,
  });
  await audit({
    action: "environment.verify_login",
    entityType: "environment",
    entityId: env.id,
    projectId,
    actorId: auth.user.id,
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });
  return job;
}

// ── Server-side helpers for jobs (decrypted values never leave the worker) ──

export interface EnvironmentSecrets {
  accounts: Record<string, { username: string; password: string }>;
  vars: Record<string, string>;
  storageState: string | null;
  loginConfig: LoginConfig | null;
  defaultAccountLabel: string | null;
}

export async function loadEnvironmentSecrets(env: Environment): Promise<EnvironmentSecrets> {
  const accounts = await db.testAccount.findMany({ where: { environmentId: env.id } });
  let storageState: string | null = null;
  if (env.storageStateKey) {
    const blob = await getStorage()
      .get(env.storageStateKey)
      .catch(() => null);
    storageState = blob ? decryptBuffer(blob.toString("utf8")).toString("utf8") : null;
  }
  return {
    accounts: Object.fromEntries(
      accounts.map((a) => [
        a.label,
        {
          username: decryptString(a.usernameEncrypted),
          password: decryptString(a.passwordEncrypted),
        },
      ]),
    ),
    vars: (env.variables as Record<string, string> | null) ?? {},
    storageState,
    loginConfig: loginConfigSchema.safeParse(env.loginConfig).data ?? null,
    defaultAccountLabel: accounts.find((a) => a.isDefault)?.label ?? null,
  };
}

/** Egress grant for an environment: exactly its approved origin. */
export async function grantedOrigins(env: Environment) {
  const target = await requireApprovedTarget(env.projectId, env.baseUrl);
  return [{ origin: target.origin, allowPrivate: target.allowPrivateNetwork }];
}
