/**
 * Phase 1 main flow: sign in → create project → upload a requirements file →
 * the worker extracts its text → read the text. Also checks security headers on a real page.
 */
import { expect, test } from "@playwright/test";

const email = process.env.E2E_EMAIL ?? "";
const password = process.env.E2E_PASSWORD ?? "";

test.beforeAll(() => {
  if (!email || !password) throw new Error("Set E2E_EMAIL and E2E_PASSWORD (an Admin account).");
});

test("upload a requirements document and read its extracted text", async ({ page }, info) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

  const name = `E2E ${info.project.name} ${Date.now()}`;
  await page.getByRole("button", { name: "New project" }).first().click();
  await page.getByLabel("Project name").fill(name);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();

  const requirement = "REQ-1 The checkout button must be disabled until terms are accepted.";
  await page.locator("#upload-REQUIREMENTS").setInputFiles({
    name: "requirements.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(requirement),
  });
  await expect(page.getByText("“requirements.txt” was added.")).toBeVisible();
  await expect(page.getByText("Text ready")).toBeVisible({ timeout: 60_000 });

  await page.getByRole("link", { name: "View text" }).click();
  await expect(page.getByText(requirement)).toBeVisible();
});

test("rejects a spoofed file with a plain-language message", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "Projects" }).waitFor();
  await page.getByRole("button", { name: "New project" }).first().click();
  await page.getByLabel("Project name").fill(`Spoof ${Date.now()}`);
  await page.getByRole("button", { name: "Create project" }).click();

  await page.locator("#upload-REQUIREMENTS").setInputFiles({
    name: "requirements.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("MZ\x90\x00 this is really an exe"),
  });
  await expect(page.getByRole("alert")).toContainText("doesn't match");
});

test("pages are served with a strict CSP and hardening headers", async ({ request }) => {
  const res = await request.get("/login");
  const csp = res.headers()["content-security-policy"] ?? "";
  expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  expect(csp).toContain("frame-ancestors 'none'");
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  expect(res.headers()["x-frame-options"]).toBe("DENY");
});
