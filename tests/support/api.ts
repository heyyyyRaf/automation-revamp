/** Calls real route handlers in-process with real cookies, Origin and CSRF headers. */
import { NextRequest } from "next/server";
import type { Role } from "@/generated/prisma/client";
import * as loginRoute from "@/app/api/auth/login/route";
import { db } from "@/server/db";
import { hashPassword } from "@/server/auth/password";

export const ORIGIN = "http://localhost:3000";
const PASSWORD = "integration-test-password";

type Handler = (
  req: NextRequest,
  args: { params: Promise<Record<string, string>> },
) => Promise<Response>;

export interface Session {
  cookie: string;
  csrf: string;
  userId: string;
}

export interface CallOptions {
  method?: string;
  session?: Session | null;
  params?: Record<string, string>;
  json?: unknown;
  form?: FormData;
  headers?: Record<string, string>;
  /** Default true. Set false to simulate a request without the CSRF header. */
  csrf?: boolean;
  origin?: string | null;
}

export async function call(handler: Handler, path: string, o: CallOptions = {}): Promise<Response> {
  const method = o.method ?? (o.json !== undefined || o.form ? "POST" : "GET");
  const headers = new Headers(o.headers);
  if (o.origin !== null && method !== "GET") headers.set("origin", o.origin ?? ORIGIN);
  if (o.session) {
    headers.set("cookie", o.session.cookie);
    if (o.csrf !== false && method !== "GET") headers.set("x-csrf-token", o.session.csrf);
  }
  let body: BodyInit | undefined;
  if (o.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(o.json);
  } else if (o.form) {
    // Let Request compute the multipart boundary.
    const encoded = new Request(`${ORIGIN}/`, { method: "POST", body: o.form });
    headers.set("content-type", encoded.headers.get("content-type") ?? "");
    body = await encoded.arrayBuffer();
  }
  const req = new NextRequest(new URL(path, ORIGIN), { method, headers, body });
  return handler(req, { params: Promise.resolve(o.params ?? {}) });
}

export async function createUser(
  role: Role,
  email = `${role.toLowerCase()}-${Math.random().toString(36).slice(2)}@test.local`,
) {
  return db.user.create({
    data: { email, name: `${role} user`, role, passwordHash: await hashPassword(PASSWORD) },
  });
}

/** Logs in through the real login route and returns the cookies it set. */
export async function login(email: string, password = PASSWORD): Promise<Session> {
  const res = await call(loginRoute.POST, "/api/auth/login", { json: { email, password } });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${await res.text()}`);
  const cookies = res.headers.getSetCookie();
  const pair = (prefix: string) => {
    const c = cookies.find((x) => x.startsWith(prefix));
    if (!c) throw new Error(`missing cookie ${prefix}`);
    return c.split(";")[0]!;
  };
  const session = pair("tqa_session=");
  const csrf = pair("tqa_csrf=");
  const { user } = (await res.json()) as { user: { id: string } };
  return { cookie: `${session}; ${csrf}`, csrf: csrf.split("=")[1]!, userId: user.id };
}

export async function userWithSession(role: Role) {
  const user = await createUser(role);
  return { user, session: await login(user.email) };
}

export async function createProject(name: string, memberIds: string[] = [], createdById?: string) {
  const creator = createdById ?? (await createUser("ADMIN")).id;
  return db.project.create({
    data: {
      name,
      createdById: creator,
      ownerId: creator,
      members: { create: memberIds.map((userId) => ({ userId })) },
    },
  });
}

export async function jsonOf<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

export function fileForm(
  category: string,
  name: string,
  data: Buffer | string,
  type = "application/octet-stream",
) {
  const form = new FormData();
  form.set("category", category);
  form.set(
    "file",
    new File([typeof data === "string" ? data : new Uint8Array(data)], name, { type }),
  );
  return form;
}

export { PASSWORD };
