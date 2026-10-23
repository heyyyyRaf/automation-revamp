import type { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import type { createUserSchema, updateUserSchema } from "@/lib/validation";
import { getDummyHash, hashPassword, verifyPassword } from "@/server/auth/password";
import {
  assertLoginAllowed,
  recordLoginFailure,
  recordLoginSuccess,
} from "@/server/auth/rate-limit";
import {
  createSession,
  deleteAllSessionsForUser,
  type NewSession,
  type SessionUser,
} from "@/server/auth/session";
import { db } from "@/server/db";
import { AppError, badRequest, conflict, notFound } from "@/server/errors";
import { audit } from "@/server/services/audit";

/** Columns safe to return to clients. Never includes passwordHash. */
export const PUBLIC_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

export type PublicUser = Prisma.UserGetPayload<{ select: typeof PUBLIC_USER_SELECT }>;

interface Meta {
  ip: string;
  userAgent?: string | undefined;
  requestId: string;
}

const INVALID_LOGIN = "Email or password is incorrect.";

export async function login(
  email: string,
  password: string,
  meta: Meta,
): Promise<{ user: SessionUser; session: NewSession }> {
  await assertLoginAllowed(email, meta.ip);

  const user = await db.user.findUnique({ where: { email } });
  // Always run argon2 so response time doesn't reveal whether the email exists.
  const ok = user
    ? await verifyPassword(user.passwordHash, password)
    : (await verifyPassword(await getDummyHash(), password), false);

  if (!user || !ok || !user.isActive) {
    await recordLoginFailure(email, meta.ip);
    await audit({
      action: "auth.login_failed",
      entityType: "user",
      entityId: user?.id ?? null,
      actorId: null,
      metadata: { reason: !user ? "unknown_email" : !ok ? "bad_password" : "inactive" },
      ipAddress: meta.ip,
      requestId: meta.requestId,
    });
    throw new AppError(401, "INVALID_CREDENTIALS", INVALID_LOGIN);
  }

  await recordLoginSuccess(email, meta.ip);
  const session = await createSession(user.id, { ipAddress: meta.ip, userAgent: meta.userAgent });
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit({
    action: "auth.login",
    entityType: "user",
    entityId: user.id,
    actorId: user.id,
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });
  return {
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    session,
  };
}

export function listUsers(): Promise<PublicUser[]> {
  return db.user.findMany({ select: PUBLIC_USER_SELECT, orderBy: { name: "asc" } });
}

export async function createUser(
  input: z.infer<typeof createUserSchema>,
  actorId: string | null,
  meta?: Meta,
): Promise<PublicUser> {
  const passwordHash = await hashPassword(input.password);
  try {
    return await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email: input.email, name: input.name, role: input.role, passwordHash },
        select: PUBLIC_USER_SELECT,
      });
      await audit(
        {
          action: "user.create",
          entityType: "user",
          entityId: user.id,
          actorId,
          metadata: { email: user.email, role: user.role },
          ipAddress: meta?.ip,
          requestId: meta?.requestId,
        },
        tx,
      );
      return user;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw conflict("A user with this email already exists.");
    }
    throw e;
  }
}

export async function updateUser(
  userId: string,
  input: z.infer<typeof updateUserSchema>,
  actorId: string,
  meta: Meta,
): Promise<PublicUser> {
  const existing = await db.user.findUnique({ where: { id: userId } });
  if (!existing) throw notFound("User");
  if (userId === actorId && (input.isActive === false || (input.role && input.role !== "ADMIN"))) {
    throw badRequest("You can't remove your own admin access or deactivate yourself.");
  }

  const data: Prisma.UserUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.role !== undefined) data.role = input.role;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  if (input.password !== undefined) data.passwordHash = await hashPassword(input.password);

  const user = await db.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: userId },
      data,
      select: PUBLIC_USER_SELECT,
    });
    await audit(
      {
        action: input.password ? "user.password_reset" : "user.update",
        entityType: "user",
        entityId: userId,
        actorId,
        // Record which fields changed, never their secret values.
        metadata: {
          fields: Object.keys(input),
          ...(input.role ? { role: input.role } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
        ipAddress: meta.ip,
        requestId: meta.requestId,
      },
      tx,
    );
    return updated;
  });

  // Role, status or password changes take effect immediately: sign the user out everywhere.
  if (input.role !== undefined || input.isActive !== undefined || input.password !== undefined) {
    await deleteAllSessionsForUser(userId);
  }
  return user;
}
