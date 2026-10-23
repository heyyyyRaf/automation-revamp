import type { Role } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { getEnv } from "@/server/env";
import { generateToken, sha256 } from "@/server/auth/tokens";

/** Sessions can be extended by activity, but never beyond this age. */
const ABSOLUTE_MAX_MS = 7 * 24 * 60 * 60 * 1000;
/** Avoid a DB write on every request: only refresh lastSeen/expiry this often. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface AuthContext {
  sessionId: string;
  csrfToken: string;
  user: SessionUser;
}

export interface NewSession {
  token: string;
  csrfToken: string;
  expiresAt: Date;
}

function ttlMs(): number {
  return getEnv().SESSION_TTL_HOURS * 60 * 60 * 1000;
}

export async function createSession(
  userId: string,
  meta: { ipAddress?: string | undefined; userAgent?: string | undefined },
): Promise<NewSession> {
  const token = generateToken();
  const csrfToken = generateToken();
  const expiresAt = new Date(Date.now() + ttlMs());
  await db.session.create({
    data: {
      tokenHash: sha256(token),
      csrfSecret: csrfToken,
      userId,
      expiresAt,
      ipAddress: meta.ipAddress?.slice(0, 64) ?? null,
      userAgent: meta.userAgent?.slice(0, 256) ?? null,
    },
  });
  return { token, csrfToken, expiresAt };
}

/** Resolves a raw cookie token to an active session + user, sliding the idle expiry. */
export async function validateSessionToken(token: string | undefined): Promise<AuthContext | null> {
  if (!token || token.length > 128) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: {
      user: { select: { id: true, email: true, name: true, role: true, isActive: true } },
    },
  });
  if (!session) return null;

  const now = Date.now();
  const absoluteExpiry = session.createdAt.getTime() + ABSOLUTE_MAX_MS;
  if (session.expiresAt.getTime() <= now || absoluteExpiry <= now || !session.user.isActive) {
    await db.session.deleteMany({ where: { id: session.id } });
    return null;
  }

  if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db.session.update({
      where: { id: session.id },
      data: {
        lastSeenAt: new Date(now),
        expiresAt: new Date(Math.min(now + ttlMs(), absoluteExpiry)),
      },
    });
  }

  const { isActive: _isActive, ...user } = session.user;
  return { sessionId: session.id, csrfToken: session.csrfSecret, user };
}

export async function deleteSession(sessionId: string): Promise<void> {
  await db.session.deleteMany({ where: { id: sessionId } });
}

export async function deleteAllSessionsForUser(userId: string): Promise<void> {
  await db.session.deleteMany({ where: { userId } });
}

export async function purgeExpiredSessions(): Promise<number> {
  const { count } = await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return count;
}
