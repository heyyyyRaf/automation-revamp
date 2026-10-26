import type { z } from "zod";
import type { Environment, Prisma } from "@/generated/prisma/client";
import type {
  accountCreateSchema,
  accountUpdateSchema,
  environmentCreateSchema,
  environmentUpdateSchema,
} from "@/lib/validation";
import type { AuthContext } from "@/server/auth/session";
import { isValidId, requireProjectAccess } from "@/server/authz/guards";
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

function variablesToObject(
  vars: { name: string; value: string }[] | undefined,
): Record<string, string> {
  return Object.fromEntries((vars ?? []).map((v) => [v.name, v.value]));
}

/** Public shape: never includes credentials — only masked usernames. */
function toDto(
  env: Environment & {
    accounts: {
      id: string;
      label: string;
      usernameHint: string;
      isDefault: boolean;
      updatedAt: Date;
    }[];
  },
) {
  return {
    id: env.id,
    name: env.name,
    baseUrl: env.baseUrl,
    variables: Object.entries((env.variables as Record<string, string> | null) ?? {}).map(
      ([name, value]) => ({
        name,
        value: String(value),
      }),
    ),
    loginConfig: loginConfigSchema.safeParse(env.loginConfig).data ?? null,
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

export async function listEnvironments(
  auth: AuthContext,
  projectId: string,
): Promise<EnvironmentDto[]> {
  await requireProjectAccess(auth, projectId, "projects:read");
  const rows = await db.environment.findMany({
    where: { projectId },
    orderBy: { name: "asc" },
    include: { accounts: { select: ACCOUNT_SELECT, orderBy: { label: "asc" } } },
  });
  return rows.map(toDto);
}

export async function findEnvironment(projectId: string, environmentId: string) {
  if (!isValidId(environmentId)) throw notFound("Environment");
  const env = await db.environment.findFirst({ where: { id: environmentId, projectId } });
  if (!env) throw notFound("Environment");
  return env;
}

async function baseUrlFor(
  projectId: string,
  targetId: string,
  basePath: string | undefined,
): Promise<string> {
  if (!isValidId(targetId)) throw notFound("Target");
  const target = await db.allowedTarget.findFirst({ where: { id: targetId, projectId } });
  if (!target) throw notFound("Target");
  if (target.status !== "APPROVED") throw conflict("Choose an address an Admin has approved.");
  return `${target.origin}${basePath && basePath !== "/" ? basePath.replace(/\/$/, "") : ""}`;
}

export async function createEnvironment(
  auth: AuthContext,
  projectId: string,
  input: z.infer<typeof environmentCreateSchema>,
  meta: Meta,
) {
  await requireProjectAccess(auth, projectId, "environments:manage");
  const baseUrl = await baseUrlFor(projectId, input.targetId, input.basePath);
  const exists = await db.environment.findUnique({
    where: { projectId_name: { projectId, name: input.name } },
  });
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
    metadata: { name: env.name, baseUrl },
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });
  return env;
}

export async function updateEnvironment(
  auth: AuthContext,
  projectId: string,
  environmentId: string,
  input: z.infer<typeof environmentUpdateSchema>,
  meta: Meta,
) {
  await requireProjectAccess(auth, projectId, "environments:manage");
  const env = await findEnvironment(projectId, environmentId);
  const data: Prisma.EnvironmentUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.variables !== undefined) data.variables = variablesToObject(input.variables);
  if (input.loginConfig !== undefined) {
    data.loginConfig = (input.loginConfig ?? undefined) as Prisma.InputJsonValue | undefined;
  }
  if (input.targetId !== undefined) {
    data.baseUrl = await baseUrlFor(projectId, input.targetId, input.basePath);
  }
  // A new address or login method invalidates the saved session.
  if (data.baseUrl !== undefined || input.loginConfig !== undefined) {
    data.storageStateKey = null;
    data.loginCheckStatus = "NOT_CHECKED";
    data.loginCheckError = null;
  }
  const updated = await db.environment.update({ where: { id: env.id }, data });
  if (env.storageStateKey && data.storageStateKey === null) {
    await getStorage()
      .delete(env.storageStateKey)
      .catch(() => undefined);
  }
  await audit({
    action: "environment.update",
    entityType: "environment",
    entityId: env.id,
    projectId,
    actorId: auth.user.id,
    metadata: { fields: Object.keys(input) },
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });
  return updated;
}

export async function deleteEnvironment(
  auth: AuthContext,
  projectId: string,
  environmentId: string,
  meta: Meta,
) {
  await requireProjectAccess(auth, projectId, "environments:manage");
  const env = await findEnvironment(projectId, environmentId);
  if (await db.run.count({ where: { environmentId: env.id } })) {
    throw conflict("This environment has run history and can't be deleted.");
  }
  await db.environment.delete({ where: { id: env.id } });
  if (env.storageStateKey)
    await getStorage()
      .delete(env.storageStateKey)
      .catch(() => undefined);
  await audit({
    action: "environment.delete",
    entityType: "environment",
    entityId: env.id,
    projectId,
    actorId: auth.user.id,
    metadata: { name: env.name },
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });
}

// ── Test accounts (credentials encrypted at rest, write-only through the API) ─

export async function addAccount(
  auth: AuthContext,
  projectId: string,
  environmentId: string,
  input: z.infer<typeof accountCreateSchema>,
  meta: Meta,
) {
  await requireProjectAccess(auth, projectId, "environments:manage");
  const env = await findEnvironment(projectId, environmentId);
  const exists = await db.testAccount.findUnique({
    where: { environmentId_label: { environmentId: env.id, label: input.label } },
  });
  if (exists) throw conflict("An account with this label already exists.");
  const first = (await db.testAccount.count({ where: { environmentId: env.id } })) === 0;
  const account = await db.$transaction(async (tx) => {
    if (input.isDefault)
      await tx.testAccount.updateMany({
        where: { environmentId: env.id },
        data: { isDefault: false },
      });
    return tx.testAccount.create({
      data: {
        environmentId: env.id,
        label: input.label,
        usernameEncrypted: encryptString(input.username),
        passwordEncrypted: encryptString(input.password),
        usernameHint: maskUsername(input.username),
        isDefault: input.isDefault ?? first,
      },
      select: ACCOUNT_SELECT,
    });
  });
  await audit({
    action: "account.create",
    entityType: "test_account",
    entityId: account.id,
    projectId,
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
  projectId: string,
  environmentId: string,
  accountId: string,
  input: z.infer<typeof accountUpdateSchema>,
  meta: Meta,
) {
  await requireProjectAccess(auth, projectId, "environments:manage");
  const env = await findEnvironment(projectId, environmentId);
  const account = await findAccount(env.id, accountId);
  const data: Prisma.TestAccountUpdateInput = {};
  if (input.label !== undefined) data.label = input.label;
  if (input.username !== undefined) {
    data.usernameEncrypted = encryptString(input.username);
    data.usernameHint = maskUsername(input.username);
  }
  if (input.password !== undefined) data.passwordEncrypted = encryptString(input.password);
  if (input.isDefault !== undefined) data.isDefault = input.isDefault;
  const updated = await db.$transaction(async (tx) => {
    if (input.isDefault)
      await tx.testAccount.updateMany({
        where: { environmentId: env.id },
        data: { isDefault: false },
      });
    return tx.testAccount.update({ where: { id: account.id }, data, select: ACCOUNT_SELECT });
  });
  await audit({
    action: "account.update",
    entityType: "test_account",
    entityId: account.id,
    projectId,
    actorId: auth.user.id,
    metadata: { fields: Object.keys(input) },
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });
  return updated;
}

export async function deleteAccount(
  auth: AuthContext,
  projectId: string,
  environmentId: string,
  accountId: string,
  meta: Meta,
) {
  await requireProjectAccess(auth, projectId, "environments:manage");
  const env = await findEnvironment(projectId, environmentId);
  const account = await findAccount(env.id, accountId);
  await db.testAccount.delete({ where: { id: account.id } });
  await audit({
    action: "account.delete",
    entityType: "test_account",
    entityId: account.id,
    projectId,
    actorId: auth.user.id,
    metadata: { label: account.label },
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });
}

/** Starts a login check in the sandbox with the default account. */
export async function verifyLogin(
  auth: AuthContext,
  projectId: string,
  environmentId: string,
  meta: Meta,
) {
  await requireProjectAccess(auth, projectId, "environments:manage");
  const env = await findEnvironment(projectId, environmentId);
  await requireApprovedTarget(projectId, env.baseUrl);
  if (!loginConfigSchema.safeParse(env.loginConfig).success) {
    throw badRequest("Add the sign-in settings (login page and field labels) first.");
  }
  if (!(await db.testAccount.findFirst({ where: { environmentId: env.id, isDefault: true } }))) {
    throw badRequest("Add a test account and mark one as default first.");
  }
  await db.environment.update({
    where: { id: env.id },
    data: { loginCheckStatus: "NOT_CHECKED", loginCheckError: "Checking…" },
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
