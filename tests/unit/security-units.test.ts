import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { can, ROLES, type Permission } from "@/lib/permissions";
import { createUserSchema, figmaLinkSchema, loginSchema, updateUserSchema } from "@/lib/validation";
import { buildCsp } from "@/proxy";
import { API_CSP, HSTS, securityHeaders } from "@/security-headers";
import { getDummyHash, hashPassword, verifyPassword } from "@/server/auth/password";
import { generateToken, safeEqual, sha256 } from "@/server/auth/tokens";
import { getEnv, resetEnvCache } from "@/server/env";
import { AppError, notFound } from "@/server/errors";
import { getClientIp } from "@/server/http/client-ip";
import { errorResponse } from "@/server/http/handler";
import { createLogger } from "@/server/logger";

function captureLogger() {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return { log: createLogger({ level: "info", destination }), lines };
}

describe("permissions matrix", () => {
  const all: Permission[] = [
    "users:manage",
    "projects:create",
    "projects:archive",
    "projects:manage-members",
    "projects:read",
    "projects:edit",
    "documents:read",
    "documents:write",
    "requirements:write",
    "testcases:write",
    "testcases:review",
    "ai:run",
    "exports:create",
    "targets:request",
    "targets:approve",
    "environments:manage",
    "scripts:write",
    "scripts:approve",
    "runs:start",
    "runs:control",
    "comments:create",
    "settings:manage",
  ];

  it("Admin can do everything", () => {
    for (const p of all) expect(can("ADMIN", p)).toBe(true);
  });

  it("QA Tester works on projects (FRD: creates them too), but does not administer", () => {
    for (const p of [
      "documents:write",
      "projects:create",
      "projects:edit",
      "comments:create",
    ] as const) {
      expect(can("QA_TESTER", p)).toBe(true);
    }
    for (const p of [
      "users:manage",
      "projects:manage-members",
      "targets:approve",
      "settings:manage",
    ] as const) {
      expect(can("QA_TESTER", p)).toBe(false);
    }
  });

  it("Viewer is read-only (exporting the scope only reads data)", () => {
    const allowed = all.filter((p) => can("VIEWER", p));
    // Viewers may also comment (FRD roles table); comments never change project data.
    expect(
      allowed.every(
        (p) => p.endsWith(":read") || p === "exports:create" || p === "comments:create",
      ),
    ).toBe(true);
    for (const p of [
      "requirements:write",
      "testcases:write",
      "testcases:review",
      "ai:run",
    ] as const) {
      expect(can("VIEWER", p)).toBe(false);
    }
  });

  it("covers exactly the three roles", () => {
    expect([...ROLES]).toEqual(["ADMIN", "QA_TESTER", "VIEWER"]);
  });
});

describe("passwords and tokens", () => {
  it("hashes with argon2id and verifies", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(hash, "correct horse battery")).toBe(true);
    expect(await verifyPassword(hash, "wrong password!!")).toBe(false);
    expect(await verifyPassword("not-a-hash", "x")).toBe(false);
    expect(await getDummyHash()).toMatch(/^\$argon2id\$/);
  });

  it("generates unpredictable tokens and compares in constant time", () => {
    const a = generateToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateToken()).not.toBe(a);
    expect(sha256(a)).toHaveLength(64);
    expect(safeEqual(a, a)).toBe(true);
    expect(safeEqual(a, generateToken())).toBe(false);
    expect(safeEqual(a, "")).toBe(false);
  });
});

describe("logging", () => {
  it("redacts secrets from structured logs", () => {
    const { log, lines } = captureLogger();
    log.info(
      {
        password: "hunter2-secret",
        user: { password: "nested-secret", email: "a@b.c" },
        headers: { cookie: "tqa_session=abc", authorization: "Bearer zzz" },
        token: "tok-secret",
      },
      "test",
    );
    const out = lines.join("");
    for (const secret of [
      "hunter2-secret",
      "nested-secret",
      "tqa_session=abc",
      "Bearer zzz",
      "tok-secret",
    ]) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain("[REDACTED]");
    expect(out).toContain("a@b.c");
  });
});

describe("error responses", () => {
  it("never leaks stack traces or internal messages for unexpected errors", async () => {
    const { log, lines } = captureLogger();
    const res = errorResponse(
      new Error("DB password is p@ss at host 10.0.0.5"),
      "req-12345678",
      log,
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { message: string; requestId: string } };
    expect(JSON.stringify(body)).not.toContain("p@ss");
    expect(JSON.stringify(body)).not.toContain("at ");
    expect(body.error.requestId).toBe("req-12345678");
    expect(lines.join("")).toContain("unhandled error");
  });

  it("returns the safe message and status for AppErrors", async () => {
    const res = errorResponse(notFound("Project"), "req-12345678", captureLogger().log);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe(
      "Project not found.",
    );
  });

  it("maps Zod errors to 422 with field messages", async () => {
    const parsed = z
      .object({ name: z.string().min(1, "Name is required.") })
      .safeParse({ name: "" });
    const res = errorResponse(parsed.error, "req-12345678", captureLogger().log);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { details: { fields: Record<string, string[]> } } };
    expect(body.error.details.fields["name"]).toEqual(["Name is required."]);
  });

  it("sets Retry-After on rate limit errors", () => {
    const err = new AppError(429, "RATE_LIMITED", "x", { retryAfterSeconds: 42 });
    expect(errorResponse(err, "req-12345678", captureLogger().log).headers.get("retry-after")).toBe(
      "42",
    );
  });
});

describe("security headers / CSP", () => {
  it("builds a nonce-based CSP without unsafe-inline scripts", () => {
    const csp = buildCsp("abc123", false, true);
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
  });

  it("only allows unsafe-eval in development", () => {
    expect(buildCsp("n", true, false)).toContain("'unsafe-eval'");
  });

  it("only upgrades to HTTPS when the app is served over HTTPS", () => {
    expect(buildCsp("n", false, true)).toContain("upgrade-insecure-requests");
    expect(buildCsp("n", false, false)).not.toContain("upgrade-insecure-requests");
  });

  it("sends standard hardening headers", () => {
    const keys = securityHeaders().map((h) => h.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "X-Content-Type-Options",
        "X-Frame-Options",
        "Referrer-Policy",
        "Permissions-Policy",
      ]),
    );
    expect(HSTS).toMatch(/max-age=\d{8}/);
    expect(API_CSP).toContain("default-src 'none'");
  });
});

describe("client IP", () => {
  const h = (xff?: string) => new Headers(xff ? { "x-forwarded-for": xff } : {});
  it("uses the entry added by trusted proxies", () => {
    expect(getClientIp(h("6.6.6.6, 1.2.3.4"), 1)).toBe("1.2.3.4");
    expect(getClientIp(h("6.6.6.6, 1.2.3.4, 10.0.0.2"), 2)).toBe("1.2.3.4");
    expect(getClientIp(h("1.2.3.4"), 0)).toBe("1.2.3.4");
    expect(getClientIp(h(), 0)).toBe("unknown");
  });
});

describe("input validation schemas", () => {
  it("normalizes email and bounds password size on login", () => {
    expect(loginSchema.parse({ email: "  Ana@Example.COM ", password: "x" }).email).toBe(
      "ana@example.com",
    );
    expect(
      loginSchema.safeParse({ email: "ana@example.com", password: "x".repeat(129) }).success,
    ).toBe(false);
  });

  it("requires strong-enough passwords for new users", () => {
    const base = { email: "a@b.co", name: "A", role: "VIEWER" };
    expect(createUserSchema.safeParse({ ...base, password: "short" }).success).toBe(false);
    expect(createUserSchema.safeParse({ ...base, password: "long-enough-pass" }).success).toBe(
      true,
    );
    expect(
      createUserSchema.safeParse({ ...base, role: "SUPERUSER", password: "long-enough-pass" })
        .success,
    ).toBe(false);
    expect(updateUserSchema.safeParse({}).success).toBe(false);
  });

  it("only accepts https figma.com links", () => {
    const ok = (url: string) => figmaLinkSchema.safeParse({ url }).success;
    expect(ok("https://www.figma.com/design/abc/My-File")).toBe(true);
    expect(ok("https://figma.com/file/abc")).toBe(true);
    expect(ok("javascript:alert(1)")).toBe(false);
    expect(ok("http://www.figma.com/file/abc")).toBe(false);
    expect(ok("https://figma.com.evil.io/file")).toBe(false);
    expect(ok("https://evil.io/?https://figma.com")).toBe(false);
  });
});

describe("environment", () => {
  it("reports missing variable names without echoing values", () => {
    const saved = { ...process.env };
    try {
      process.env = { NODE_ENV: "test", S3_SECRET_ACCESS_KEY: "super-secret-value" };
      resetEnvCache();
      let message = "";
      try {
        getEnv();
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toContain("DATABASE_URL");
      expect(message).not.toContain("super-secret-value");
    } finally {
      process.env = saved;
      resetEnvCache();
    }
  });
});
