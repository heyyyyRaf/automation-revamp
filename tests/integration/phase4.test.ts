/**
 * Phase 4 (FR-9, FRD steps 7–8): run report, requirement coverage, likely cause, re-run failed,
 * defects, report export (HTML / PDF), share links (option b) and the audit log viewer.
 */
import { beforeEach, describe, expect, it } from "vitest";
import * as auditRoute from "@/app/api/admin/audit/route";
import * as coverageRoute from "@/app/api/projects/[projectId]/coverage/route";
import * as defectRoute from "@/app/api/projects/[projectId]/defects/[defectId]/route";
import * as defectsRoute from "@/app/api/projects/[projectId]/defects/route";
import * as exportFileRoute from "@/app/api/projects/[projectId]/exports/[exportId]/file/route";
import * as envsRoute from "@/app/api/projects/[projectId]/environments/route";
import * as verifyRoute from "@/app/api/projects/[projectId]/environments/[environmentId]/verify/route";
import * as accountsRoute from "@/app/api/projects/[projectId]/environments/[environmentId]/accounts/route";
import * as analysisRoute from "@/app/api/projects/[projectId]/runs/[runId]/analysis/route";
import * as runExportsRoute from "@/app/api/projects/[projectId]/runs/[runId]/exports/route";
import * as reportRoute from "@/app/api/projects/[projectId]/runs/[runId]/report/route";
import * as rerunRoute from "@/app/api/projects/[projectId]/runs/[runId]/rerun/route";
import * as shareRoute from "@/app/api/projects/[projectId]/runs/[runId]/shares/[shareId]/route";
import * as sharesRoute from "@/app/api/projects/[projectId]/runs/[runId]/shares/route";
import * as runsRoute from "@/app/api/projects/[projectId]/runs/route";
import * as approvalRoute from "@/app/api/projects/[projectId]/scripts/[scriptId]/approval/route";
import * as versionsRoute from "@/app/api/projects/[projectId]/scripts/[scriptId]/versions/route";
import * as scriptsRoute from "@/app/api/projects/[projectId]/scripts/route";
import * as targetRoute from "@/app/api/projects/[projectId]/targets/[targetId]/route";
import * as targetsRoute from "@/app/api/projects/[projectId]/targets/route";
import * as publicShotRoute from "@/app/api/share/[token]/screenshots/[runTestId]/route";
import { getFakeProvider } from "@/server/ai/provider";
import { sha256 } from "@/server/auth/tokens";
import { db } from "@/server/db";
import { setEgress } from "@/server/sandbox/egress";
import { setSandbox } from "@/server/sandbox/sandbox";
import { getSharedReport } from "@/server/services/shares";
import { getStorage, newObjectKey } from "@/server/storage/storage";
import { call, createProject, jsonOf, userWithSession, type Session } from "../support/api";
import { FakeSandbox } from "../support/fake-sandbox";
import { runJob, runQueued } from "../support/jobs";

let tester: Session;
let viewer: Session;
let lead: Session;
let outsider: Session;
let projectId: string;
let sandbox: FakeSandbox;
let grants: { label: string; origins: unknown[] }[];

const PASSWORD = "Sup3r-Secret-Pw!";
const META = { ip: "203.0.113.9", requestId: "test-request-1" };

beforeEach(async () => {
  const t = await userWithSession("QA_TESTER");
  const v = await userWithSession("VIEWER");
  const a = await userWithSession("ADMIN");
  const o = await userWithSession("QA_TESTER");
  tester = t.session;
  viewer = v.session;
  lead = a.session;
  outsider = o.session;
  projectId = (await createProject("Leave Portal", [t.user.id, v.user.id], a.user.id)).id;
  await createProject("Other", [o.user.id], a.user.id);
  sandbox = new FakeSandbox();
  setSandbox(sandbox);
  grants = [];
  setEgress({
    grant: async (label, origins) => {
      grants.push({ label, origins });
      return {
        proxy: { server: "http://127.0.0.1:9", username: "run", password: "egress-token-xyz" },
        revoke: async () => undefined,
      };
    },
  });
});

// ── Setup: a verified environment with a test account, approved scripted cases ──

async function verifiedEnvironment() {
  const req = await call(targetsRoute.POST, "/", {
    session: tester,
    params: { projectId },
    json: { url: "https://staging.example.com" },
  });
  const { target } = await jsonOf<{ target: { id: string } }>(req);
  await call(targetRoute.PATCH, "/", {
    method: "PATCH",
    session: lead,
    params: { projectId, targetId: target.id },
    json: { decision: "APPROVE" },
  });
  const res = await call(envsRoute.POST, "/", {
    session: tester,
    params: { projectId },
    json: {
      name: "Staging",
      targetId: target.id,
      loginConfig: {
        path: "/login",
        usernameLabel: "Email",
        passwordLabel: "Password",
        submitLabel: "Sign in",
      },
    },
  });
  const { environment } = await jsonOf<{ environment: { id: string } }>(res);
  await call(accountsRoute.POST, "/", {
    session: tester,
    params: { projectId, environmentId: environment.id },
    json: { label: "Standard user", username: "ana@leave.test", password: PASSWORD },
  });
  const v = await call(verifyRoute.POST, "/", {
    session: tester,
    params: { projectId, environmentId: environment.id },
  });
  const { job } = await jsonOf<{ job: { id: string } }>(v);
  expect(await runJob(job.id)).toEqual({ outcome: "succeeded" });
  return environment.id;
}

let caseNo = 0;
async function testCase(title: string, automatable = true) {
  caseNo++;
  return db.testCase.create({
    data: {
      projectId,
      key: `TC-${String(caseNo).padStart(3, "0")}`,
      title,
      preconditions: "None",
      steps: [{ action: "Open /leave", expected: null }],
      testData: { none: "not needed" },
      expectedResult: "It works",
      type: "POSITIVE",
      priority: "HIGH",
      automatable,
      automatableReason: automatable ? "UI steps" : "Needs a real email inbox",
      origin: "MANUAL",
      status: "APPROVED",
      tags: [],
    },
  });
}

let reqNo = 0;
async function requirement(text: string, caseIds: string[]) {
  reqNo++;
  return db.requirement.create({
    data: {
      projectId,
      key: `REQ-${String(reqNo).padStart(3, "0")}`,
      text,
      type: "FEATURE",
      origin: "MANUAL",
      testCases: { create: caseIds.map((testCaseId) => ({ testCaseId })) },
    },
  });
}

/** codes: "ok" passes, "WILL_FAIL" fails, "WILL_TIME_OUT" errors (see FakeSandbox). */
async function finishedRun(codes: string[]) {
  const envId = await verifiedEnvironment();
  const cases = [];
  for (const c of codes) cases.push(await testCase(`Case ${c} ${cases.length + 1}`));
  const gen = await call(scriptsRoute.POST, "/", {
    session: tester,
    params: { projectId },
    json: { environmentId: envId },
  });
  const { job } = await jsonOf<{ job: { id: string } }>(gen);
  expect(await runJob(job.id)).toEqual({ outcome: "succeeded" });
  for (const [i, tc] of cases.entries()) {
    const script = await db.script.findUniqueOrThrow({ where: { testCaseId: tc.id } });
    let latest = await db.scriptVersion.findFirstOrThrow({
      where: { scriptId: script.id },
      orderBy: { version: "desc" },
    });
    if (codes[i] !== "ok") {
      const res = await call(versionsRoute.POST, "/", {
        session: tester,
        params: { projectId, scriptId: script.id },
        json: { code: `${latest.code}\n// ${codes[i]}\n` },
      });
      expect(res.status).toBe(201);
      latest = await db.scriptVersion.findFirstOrThrow({
        where: { scriptId: script.id },
        orderBy: { version: "desc" },
      });
    }
    const ok = await call(approvalRoute.POST, "/", {
      session: tester,
      params: { projectId, scriptId: script.id },
      json: { versionId: latest.id },
    });
    expect(ok.status).toBe(200);
  }
  const res = await call(runsRoute.POST, "/", {
    session: tester,
    params: { projectId },
    json: { environmentId: envId, retries: 1, timeoutSeconds: 45 },
  });
  expect(res.status).toBe(201);
  const { run } = await jsonOf<{ run: { id: string } }>(res);
  expect(await runQueued(projectId, "EXECUTE_RUN")).toEqual([{ outcome: "succeeded" }]);
  return { envId, cases, runId: run.id };
}

type Report = {
  run: { number: number; status: string; environment: string; baseUrl?: string };
  totals: Record<string, number | null>;
  failures: {
    runTestId: string;
    testCaseId: string;
    key: string;
    status: string;
    likelyCause: string | null;
    causeExplanation: string | null;
    requirementKeys: string[];
    defect: { key: string } | null;
  }[];
  manualCases: { key: string }[];
  coverage: { total: number; covered: number; rows: { key: string; status: string }[] };
  analysis: { status: string } | null;
};

async function report(runId: string, session = tester) {
  const res = await call(reportRoute.GET, "/", { session, params: { projectId, runId } });
  return {
    status: res.status,
    body: res.status === 200 ? (await jsonOf<{ report: Report }>(res)).report : null,
  };
}

async function addScreenshot(runTestId: string) {
  const key = newObjectKey(projectId, "artifacts");
  // A real 1×1 PNG, so the report builder can resize it.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  await getStorage().put(key, png, "image/png");
  await db.runTest.update({ where: { id: runTestId }, data: { screenshotKey: key } });
}

// ── Report, coverage and likely cause ─────────────────────────────────────────

describe("run report (FR-9.1, FR-9.2, FR-9.3)", () => {
  it("shows totals, failures with their likely cause, manual cases and coverage", async () => {
    const { runId, cases } = await finishedRun(["ok", "WILL_FAIL", "WILL_TIME_OUT"]);
    const manual = await testCase("Email reaches the manager", false);
    const extra = await testCase("Approved but never run");
    await requirement("Submit a leave request", [cases[0]!.id]);
    await requirement("Block requests over the balance", [cases[1]!.id]);
    await requirement("Email the manager", [manual.id]);
    await requirement("Export history", []);
    await requirement("Filter by month", [extra.id]);

    // The likely-cause analysis was queued when the run failed.
    const before = (await report(runId)).body!;
    expect(before.analysis?.status).toBe("QUEUED");
    expect(before.failures.every((f) => f.likelyCause === null)).toBe(true);
    expect(await runQueued(projectId, "ANALYZE_FAILURES")).toEqual([{ outcome: "succeeded" }]);

    const { status, body } = await report(runId, viewer);
    expect(status).toBe(200);
    expect(body!.totals).toEqual({
      automated: 3,
      passed: 1,
      failed: 1,
      errors: 1,
      skipped: 0,
      manual: 1,
      passRate: 33,
    });
    expect(body!.run).toMatchObject({ number: 1, status: "FAILED", environment: "Staging" });
    const byKey = Object.fromEntries(body!.failures.map((f) => [f.key, f]));
    expect(byKey[cases[1]!.key]).toMatchObject({
      status: "FAILED",
      likelyCause: "SCRIPT_ISSUE",
      requirementKeys: ["REQ-002"],
    });
    expect(byKey[cases[2]!.key]).toMatchObject({ status: "ERROR", likelyCause: "ENVIRONMENT" });
    expect(body!.manualCases.map((m) => m.key)).toEqual([manual.key]);

    // FR-9.2: requirement → cases → latest result.
    expect(body!.coverage).toMatchObject({ total: 5, covered: 4 });
    expect(Object.fromEntries(body!.coverage.rows.map((r) => [r.key, r.status]))).toEqual({
      "REQ-001": "PASSING",
      "REQ-002": "FAILING",
      "REQ-003": "MANUAL",
      "REQ-004": "NOT_COVERED",
      "REQ-005": "NOT_RUN",
    });
    const cov = await jsonOf<{ coverage: { covered: number } }>(
      await call(coverageRoute.GET, "/", { session: viewer, params: { projectId } }),
    );
    expect(cov.coverage.covered).toBe(4);
  });

  it("never sends test credentials to the AI, and only members see the report", async () => {
    const { runId } = await finishedRun(["WILL_FAIL"]);
    await runQueued(projectId, "ANALYZE_FAILURES");
    const calls = getFakeProvider().calls.filter((c) => c.purpose === "ANALYZE_FAILURES");
    expect(calls).toHaveLength(1);
    const sent = JSON.stringify(calls[0]!.content) + calls[0]!.system;
    expect(sent).not.toContain(PASSWORD);
    expect(sent).not.toContain("ana@leave.test");

    expect((await report(runId, outsider)).status).toBe(404);
  });

  it("can look for the likely causes again, but not when nothing failed", async () => {
    const { runId } = await finishedRun(["WILL_FAIL"]);
    await runQueued(projectId, "ANALYZE_FAILURES");
    const again = await call(analysisRoute.POST, "/", {
      session: tester,
      params: { projectId, runId },
    });
    expect(again.status).toBe(202);
    // One at a time.
    const twice = await call(analysisRoute.POST, "/", {
      session: tester,
      params: { projectId, runId },
    });
    expect(twice.status).toBe(409);
    const asViewer = await call(analysisRoute.POST, "/", {
      session: viewer,
      params: { projectId, runId },
    });
    expect(asViewer.status).toBe(403);
    await runQueued(projectId, "ANALYZE_FAILURES");

    const passing = await db.run.create({
      data: {
        projectId,
        environmentId: (await db.run.findUniqueOrThrow({ where: { id: runId } })).environmentId,
        triggeredById: tester.userId,
        status: "PASSED",
        finishedAt: new Date(),
      },
    });
    const none = await call(analysisRoute.POST, "/", {
      session: tester,
      params: { projectId, runId: passing.id },
    });
    expect(none.status).toBe(409);
  });
});

// ── Re-run failed ─────────────────────────────────────────────────────────────

describe("re-run failed (design: Re-run N failed)", () => {
  it("starts a new run of the failed and errored cases with the same options", async () => {
    const { runId, cases, envId } = await finishedRun(["ok", "WILL_FAIL", "WILL_TIME_OUT"]);
    const res = await call(rerunRoute.POST, "/", {
      session: tester,
      params: { projectId, runId },
      json: {},
    });
    expect(res.status).toBe(201);
    const { run } = await jsonOf<{ run: { id: string } }>(res);
    const fresh = await db.run.findUniqueOrThrow({
      where: { id: run.id },
      include: { tests: true },
    });
    expect(fresh).toMatchObject({ environmentId: envId, retries: 1, timeoutSeconds: 45 });
    expect(fresh.tests.map((t) => t.testCaseId).sort()).toEqual(
      [cases[1]!.id, cases[2]!.id].sort(),
    );
    // One run at a time per project.
    const busy = await call(rerunRoute.POST, "/", {
      session: tester,
      params: { projectId, runId },
      json: {},
    });
    expect(busy.status).toBe(409);
  });

  it("re-runs one failed case; a case that passed or a viewer is refused", async () => {
    const { runId, cases } = await finishedRun(["ok", "WILL_FAIL"]);
    const passed = await call(rerunRoute.POST, "/", {
      session: tester,
      params: { projectId, runId },
      json: { testCaseIds: [cases[0]!.id] },
    });
    expect(passed.status).toBe(409);
    const asViewer = await call(rerunRoute.POST, "/", {
      session: viewer,
      params: { projectId, runId },
      json: {},
    });
    expect(asViewer.status).toBe(403);
    const one = await call(rerunRoute.POST, "/", {
      session: tester,
      params: { projectId, runId },
      json: { testCaseIds: [cases[1]!.id] },
    });
    expect(one.status).toBe(201);
  });
});

// ── Defects ───────────────────────────────────────────────────────────────────

describe("defects (FRD step 7)", () => {
  it("logs a failed result as a defect, then tracks it with an audited history", async () => {
    const { runId, cases } = await finishedRun(["WILL_FAIL"]);
    const failure = (await report(runId)).body!.failures[0]!;
    const res = await call(defectsRoute.POST, "/", {
      session: tester,
      params: { projectId },
      json: {
        title: "Balance check missing",
        description: "Request saved as Pending.",
        severity: "HIGH",
        externalUrl: "https://jira.example.com/browse/LEAVE-12",
        runTestId: failure.runTestId,
      },
    });
    expect(res.status).toBe(201);
    const { defect } = await jsonOf<{
      defect: { id: string; key: string; testCase: { id: string }; status: string };
    }>(res);
    expect(defect).toMatchObject({
      key: "BUG-001",
      status: "OPEN",
      testCase: { id: cases[0]!.id },
    });
    expect((await report(runId)).body!.failures[0]!.defect).toMatchObject({ key: "BUG-001" });

    const upd = await call(defectRoute.PATCH, "/", {
      method: "PATCH",
      session: tester,
      params: { projectId, defectId: defect.id },
      json: { status: "RESOLVED", severity: "MEDIUM" },
    });
    expect(upd.status).toBe(200);
    const stored = await db.defect.findUniqueOrThrow({ where: { id: defect.id } });
    expect(stored.resolvedAt).not.toBeNull();
    const log = await db.auditLog.findFirstOrThrow({
      where: { action: "defect.update", entityId: defect.id },
    });
    expect(log.before).toEqual({ status: "OPEN", severity: "HIGH" });
    expect(log.after).toEqual({ status: "RESOLVED", severity: "MEDIUM" });

    const list = await jsonOf<{ defects: { key: string }[] }>(
      await call(defectsRoute.GET, "/?status=RESOLVED", { session: viewer, params: { projectId } }),
    );
    expect(list.defects.map((d) => d.key)).toEqual(["BUG-001"]);
  });

  it("refuses viewers, unsafe links and results from other projects", async () => {
    const { runId } = await finishedRun(["WILL_FAIL"]);
    const failure = (await report(runId)).body!.failures[0]!;
    const asViewer = await call(defectsRoute.POST, "/", {
      session: viewer,
      params: { projectId },
      json: { title: "X" },
    });
    expect(asViewer.status).toBe(403);
    const badLink = await call(defectsRoute.POST, "/", {
      session: tester,
      params: { projectId },
      json: { title: "X", externalUrl: "javascript:alert(1)" },
    });
    expect(badLink.status).toBe(422);
    const otherProject = await db.project.findFirstOrThrow({ where: { name: "Other" } });
    const cross = await call(defectsRoute.POST, "/", {
      session: outsider,
      params: { projectId: otherProject.id },
      json: { title: "X", runTestId: failure.runTestId },
    });
    expect(cross.status).toBe(404);
  });
});

// ── Export ────────────────────────────────────────────────────────────────────

describe("report export (FR-9.4)", () => {
  it("builds a self-contained, escaped HTML report with the failure screenshot", async () => {
    const { runId, cases } = await finishedRun(["WILL_FAIL"]);
    await db.testCase.update({
      where: { id: cases[0]!.id },
      data: { title: '<script>alert("x")</script> Balance' },
    });
    const failure = (await report(runId)).body!.failures[0]!;
    await addScreenshot(failure.runTestId);

    const res = await call(runExportsRoute.POST, "/", {
      session: viewer,
      params: { projectId, runId },
      json: { format: "HTML" },
    });
    expect(res.status).toBe(202);
    expect(await runQueued(projectId, "EXPORT")).toEqual([{ outcome: "succeeded" }]);
    const list = await jsonOf<{ exports: { id: string; status: string; format: string }[] }>(
      await call(runExportsRoute.GET, "/", { session: viewer, params: { projectId, runId } }),
    );
    expect(list.exports).toEqual([
      expect.objectContaining({ status: "SUCCEEDED", format: "HTML" }),
    ]);
    const file = await call(exportFileRoute.GET, "/", {
      session: viewer,
      params: { projectId, exportId: list.exports[0]!.id },
    });
    expect(file.headers.get("content-disposition")).toMatch(/^attachment;.*Run%201%20report\.html/);
    expect(file.headers.get("content-security-policy")).toContain("sandbox");
    const html = await file.text();
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("data:image/jpeg;base64,");
    expect(html).toContain("default-src 'none'");
  });

  it("prints the PDF in a sandbox that can reach nothing", async () => {
    const { runId } = await finishedRun(["ok"]);
    const res = await call(runExportsRoute.POST, "/", {
      session: tester,
      params: { projectId, runId },
      json: { format: "PDF" },
    });
    expect(res.status).toBe(202);
    expect(await runQueued(projectId, "EXPORT")).toEqual([{ outcome: "succeeded" }]);
    const input = sandbox.inputs.find((i) => i.mode === "pdf")!;
    expect(input.accounts).toEqual({});
    expect(input.pdf?.html).toContain("Run #1 report");
    expect(grants.find((g) => g.label.startsWith("pdf:"))?.origins).toEqual([]);
    const exp = await db.export.findFirstOrThrow({ where: { runId, format: "PDF" } });
    const bytes = await getStorage().get(exp.storageKey!);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("can't export a run that is still going", async () => {
    const { runId } = await finishedRun(["ok"]);
    await db.run.update({ where: { id: runId }, data: { status: "RUNNING" } });
    const res = await call(runExportsRoute.POST, "/", {
      session: tester,
      params: { projectId, runId },
      json: { format: "PDF" },
    });
    expect(res.status).toBe(400);
  });
});

// ── Share links (option b) ────────────────────────────────────────────────────

describe("share links (FR-9.4, option b)", () => {
  it("only the Lead turns on a public link; only its hash is stored; it shows a trimmed report", async () => {
    const { runId } = await finishedRun(["WILL_FAIL"]);
    const failure = (await report(runId)).body!.failures[0]!;
    await addScreenshot(failure.runTestId);

    const asTester = await call(sharesRoute.POST, "/", {
      session: tester,
      params: { projectId, runId },
      json: { days: 7 },
    });
    expect(asTester.status).toBe(403);

    const res = await call(sharesRoute.POST, "/", {
      session: lead,
      params: { projectId, runId },
      json: { days: 1 },
    });
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const { share } = await jsonOf<{ share: { id: string; token: string; path: string } }>(res);
    expect(share.path).toBe(`/share/${share.token}`);
    const row = await db.reportShare.findUniqueOrThrow({ where: { id: share.id } });
    expect(row.tokenHash).toBe(sha256(share.token));
    expect(JSON.stringify(row)).not.toContain(share.token);
    expect(row.expiresAt.getTime() - Date.now()).toBeGreaterThan(23 * 3600_000);

    const listed = await jsonOf<{ shares: object[] }>(
      await call(sharesRoute.GET, "/", { session: lead, params: { projectId, runId } }),
    );
    expect(JSON.stringify(listed)).not.toContain(share.token);

    const shared = await getSharedReport(share.token, META);
    expect(shared.report.run).not.toHaveProperty("baseUrl");
    expect(shared.report.failures).toHaveLength(1);
    expect(
      await db.auditLog.count({
        where: { action: "report.share_view", entityId: runId, actorId: null },
      }),
    ).toBe(1);

    // The public screenshot route serves only this run's failure screenshots.
    const shot = await call(publicShotRoute.GET, "/", {
      params: { token: share.token, runTestId: failure.runTestId },
    });
    expect(shot.status).toBe(200);
    expect(shot.headers.get("x-robots-tag")).toContain("noindex");
    const otherTest = await call(publicShotRoute.GET, "/", {
      params: { token: share.token, runTestId: "c".repeat(25) },
    });
    expect(otherTest.status).toBe(404);

    // Turned off → gone.
    const off = await call(shareRoute.DELETE, "/", {
      method: "DELETE",
      session: lead,
      params: { projectId, runId, shareId: share.id },
    });
    expect(off.status).toBe(204);
    await expect(getSharedReport(share.token, META)).rejects.toMatchObject({ status: 404 });
  });

  it("expired links stop working and guessing is rate-limited", async () => {
    const { runId } = await finishedRun(["ok"]);
    const res = await call(sharesRoute.POST, "/", {
      session: lead,
      params: { projectId, runId },
      json: { days: 7 },
    });
    const { share } = await jsonOf<{ share: { id: string; token: string } }>(res);
    await db.reportShare.update({
      where: { id: share.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(getSharedReport(share.token, META)).rejects.toMatchObject({ status: 404 });

    const ip = { ...META, ip: "198.51.100.7" };
    for (let i = 0; i < 30; i++) {
      await expect(getSharedReport(`${"x".repeat(42)}${i % 10}`, ip)).rejects.toMatchObject({
        status: 404,
      });
    }
    await expect(getSharedReport("y".repeat(43), ip)).rejects.toMatchObject({ status: 429 });
  });
});

// ── Audit log viewer ──────────────────────────────────────────────────────────

describe("audit log viewer", () => {
  it("lets the Lead filter entries by kind and project; others are refused", async () => {
    await finishedRun(["ok"]);
    const res = await call(auditRoute.GET, `/?action=run&projectId=${projectId}`, {
      session: lead,
    });
    expect(res.status).toBe(200);
    const page = await jsonOf<{ entries: { action: string; project: { id: string } }[] }>(res);
    expect(page.entries.length).toBeGreaterThan(0);
    expect(
      page.entries.every((e) => e.action.startsWith("run.") && e.project.id === projectId),
    ).toBe(true);
    expect((await call(auditRoute.GET, "/", { session: tester })).status).toBe(403);
  });
});
