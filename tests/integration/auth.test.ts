import { describe, expect, it } from "vitest";
import * as loginRoute from "@/app/api/auth/login/route";
import * as logoutRoute from "@/app/api/auth/logout/route";
import * as meRoute from "@/app/api/auth/me/route";
import * as passwordRoute from "@/app/api/auth/password/route";
import * as projectsRoute from "@/app/api/projects/route";
import * as userRoute from "@/app/api/admin/users/[userId]/route";
import { db } from "@/server/db";
import { PASSWORD, call, createUser, jsonOf, login, userWithSession } from "../support/api";

describe("login", () => {
  it("sets an HttpOnly, SameSite=Lax session cookie and a readable CSRF cookie", async () => {
    const user = await createUser("QA_TESTER");
    const res = await call(loginRoute.POST, "/api/auth/login", {
      json: { email: user.email.toUpperCase(), password: PASSWORD },
    });
    expect(res.status).toBe(200);
    const cookies = res.headers.getSetCookie();
    const session = cookies.find((c) => c.startsWith("tqa_session="))!;
    const csrf = cookies.find((c) => c.startsWith("tqa_csrf="))!;
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/SameSite=lax/i);
    expect(session).toMatch(/Path=\//);
    expect(csrf).not.toMatch(/HttpOnly/i);
    const body = await jsonOf<{ user: Record<string, unknown> }>(res);
    expect(body.user).not.toHaveProperty("passwordHash");
  });

  it("stores only a hash of the session token", async () => {
    const user = await createUser("VIEWER");
    const s = await login(user.email);
    const raw = s.cookie.split(";")[0]!.split("=")[1]!;
    const row = await db.session.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.tokenHash).not.toBe(raw);
    expect(row.tokenHash).toHaveLength(64);
  });

  it("gives the same generic error for a wrong password and an unknown email", async () => {
    const user = await createUser("VIEWER");
    const a = await call(loginRoute.POST, "/", {
      json: { email: user.email, password: "wrong-password" },
    });
    const b = await call(loginRoute.POST, "/", {
      json: { email: "nobody@test.local", password: "wrong-password" },
    });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    const ma = (await jsonOf<{ error: { message: string } }>(a)).error.message;
    const mb = (await jsonOf<{ error: { message: string } }>(b)).error.message;
    expect(ma).toBe(mb);
  });

  it("rejects deactivated users", async () => {
    const user = await createUser("QA_TESTER");
    await db.user.update({ where: { id: user.id }, data: { isActive: false } });
    const res = await call(loginRoute.POST, "/", {
      json: { email: user.email, password: PASSWORD },
    });
    expect(res.status).toBe(401);
  });

  it("rate-limits repeated failures, even if the right password follows", async () => {
    const user = await createUser("QA_TESTER");
    for (let i = 0; i < 5; i++) {
      const r = await call(loginRoute.POST, "/", {
        json: { email: user.email, password: "nope-nope" },
      });
      expect(r.status).toBe(401);
    }
    const blocked = await call(loginRoute.POST, "/", {
      json: { email: user.email, password: PASSWORD },
    });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("validates input", async () => {
    const res = await call(loginRoute.POST, "/", { json: { email: "not-an-email", password: "" } });
    expect(res.status).toBe(422);
    const bad = await call(loginRoute.POST, "/", {
      headers: { "content-type": "application/json" },
      method: "POST",
      json: undefined,
    });
    expect([400, 422]).toContain(bad.status);
  });

  it("records successful and failed logins in the audit log", async () => {
    const user = await createUser("VIEWER");
    await call(loginRoute.POST, "/", { json: { email: user.email, password: "bad-password" } });
    await login(user.email);
    const actions = (await db.auditLog.findMany({ where: { entityId: user.id } })).map(
      (a) => a.action,
    );
    expect(actions).toEqual(expect.arrayContaining(["auth.login_failed", "auth.login"]));
    const all = JSON.stringify(await db.auditLog.findMany());
    expect(all).not.toContain(PASSWORD);
    expect(all).not.toContain("bad-password");
  });
});

describe("sessions", () => {
  it("requires a session for protected routes", async () => {
    expect((await call(meRoute.GET, "/api/auth/me")).status).toBe(401);
    const forged = { cookie: "tqa_session=forged-token", csrf: "x", userId: "x" };
    expect((await call(meRoute.GET, "/api/auth/me", { session: forged })).status).toBe(401);
  });

  it("logout invalidates the session server-side", async () => {
    const { session } = await userWithSession("QA_TESTER");
    expect((await call(meRoute.GET, "/", { session })).status).toBe(200);
    expect((await call(logoutRoute.POST, "/", { method: "POST", session })).status).toBe(200);
    expect((await call(meRoute.GET, "/", { session })).status).toBe(401);
  });

  it("rejects expired sessions", async () => {
    const { user, session } = await userWithSession("QA_TESTER");
    await db.session.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await call(meRoute.GET, "/", { session })).status).toBe(401);
  });

  it("signs a user out everywhere when an admin changes their role or password", async () => {
    const admin = await userWithSession("ADMIN");
    const target = await userWithSession("QA_TESTER");
    const res = await call(userRoute.PATCH, "/", {
      method: "PATCH",
      session: admin.session,
      params: { userId: target.user.id },
      json: { role: "VIEWER" },
    });
    expect(res.status).toBe(200);
    expect((await call(meRoute.GET, "/", { session: target.session })).status).toBe(401);
  });
});

describe("CSRF and origin checks", () => {
  it("rejects state-changing requests without the CSRF header", async () => {
    const { session } = await userWithSession("ADMIN");
    const res = await call(projectsRoute.POST, "/api/projects", {
      session,
      json: { name: "X" },
      csrf: false,
    });
    expect(res.status).toBe(403);
    expect(await db.project.count()).toBe(0);
  });

  it("rejects a wrong CSRF token", async () => {
    const { session } = await userWithSession("ADMIN");
    const res = await call(projectsRoute.POST, "/", {
      session: { ...session, csrf: "attacker-guess" },
      json: { name: "X" },
    });
    expect(res.status).toBe(403);
  });

  it("rejects cross-site origins, including on login", async () => {
    const { session } = await userWithSession("ADMIN");
    const res = await call(projectsRoute.POST, "/", {
      session,
      json: { name: "X" },
      origin: "https://evil.example",
    });
    expect(res.status).toBe(403);
    const user = await createUser("VIEWER");
    const l = await call(loginRoute.POST, "/", {
      json: { email: user.email, password: PASSWORD },
      origin: "https://evil.example",
    });
    expect(l.status).toBe(403);
    const none = await call(loginRoute.POST, "/", {
      json: { email: user.email, password: PASSWORD },
      origin: null,
    });
    expect(none.status).toBe(403);
  });

  it("allows safe GET requests without a CSRF header", async () => {
    const { session } = await userWithSession("VIEWER");
    expect((await call(projectsRoute.GET, "/api/projects", { session })).status).toBe(200);
  });

  it("returns a request id on every response", async () => {
    const res = await call(meRoute.GET, "/");
    expect(res.headers.get("x-request-id")).toMatch(/[0-9a-f-]{36}/);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("change my password", () => {
  const NEW = "N3w-Password!";

  it("needs the current password, enforces the rules and signs out other sessions", async () => {
    const user = await createUser("QA_TESTER");
    const here = await login(user.email);
    const elsewhere = await login(user.email);

    const wrong = await call(passwordRoute.POST, "/", {
      session: here,
      json: { currentPassword: "not-my-password", newPassword: NEW },
    });
    expect(wrong.status).toBe(422);
    const weak = await call(passwordRoute.POST, "/", {
      session: here,
      json: { currentPassword: PASSWORD, newPassword: "alllowercase1!" },
    });
    expect(weak.status).toBe(422);
    const same = await call(passwordRoute.POST, "/", {
      session: here,
      json: { currentPassword: PASSWORD, newPassword: PASSWORD },
    });
    expect(same.status).toBe(422);

    const ok = await call(passwordRoute.POST, "/", {
      session: here,
      json: { currentPassword: PASSWORD, newPassword: NEW },
    });
    expect(ok.status).toBe(200);
    // This session stays; the other one is signed out.
    expect((await call(meRoute.GET, "/", { session: here })).status).toBe(200);
    expect((await call(meRoute.GET, "/", { session: elsewhere })).status).toBe(401);
    // Old password no longer works; the new one does.
    await expect(login(user.email)).rejects.toThrow(/401/);
    expect((await login(user.email, NEW)).userId).toBe(user.id);
    const log = await db.auditLog.findFirstOrThrow({
      where: { action: "user.password_change", entityId: user.id },
    });
    expect(JSON.stringify(log)).not.toContain(NEW);
  });

  it("requires a signed-in user and the CSRF token", async () => {
    const anon = await call(passwordRoute.POST, "/", {
      json: { currentPassword: PASSWORD, newPassword: NEW },
    });
    expect(anon.status).toBe(401);
    const { session } = await userWithSession("VIEWER");
    const noCsrf = await call(passwordRoute.POST, "/", {
      session,
      csrf: false,
      json: { currentPassword: PASSWORD, newPassword: NEW },
    });
    expect(noCsrf.status).toBe(403);
  });
});
