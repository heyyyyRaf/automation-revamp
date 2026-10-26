/**
 * Phase 3 aligned to the FRD (steps 4–6): environments and their verification, script
 * generation / edit / fix / approval, and runs — with a scripted fake sandbox (no Docker).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import * as adminEnvsRoute from "@/app/api/admin/environments/route";
import * as adminTargetsRoute from "@/app/api/admin/targets/route";
import * as accountRoute from "@/app/api/projects/[projectId]/environments/[environmentId]/accounts/[accountId]/route";
import * as accountsRoute from "@/app/api/projects/[projectId]/environments/[environmentId]/accounts/route";
import * as envRoute from "@/app/api/projects/[projectId]/environments/[environmentId]/route";
import * as verifyRoute from "@/app/api/projects/[projectId]/environments/[environmentId]/verify/route";
import * as envsRoute from "@/app/api/projects/[projectId]/environments/route";
import * as controlRoute from "@/app/api/projects/[projectId]/runs/[runId]/control/route";
import * as runRoute from "@/app/api/projects/[projectId]/runs/[runId]/route";
import * as stepShotRoute from "@/app/api/projects/[projectId]/runs/[runId]/steps/[stepId]/screenshot/route";
import * as artifactRoute from "@/app/api/projects/[projectId]/runs/[runId]/tests/[runTestId]/[kind]/route";
import * as runsRoute from "@/app/api/projects/[projectId]/runs/route";
import * as approvalRoute from "@/app/api/projects/[projectId]/scripts/[scriptId]/approval/route";
import * as fixRoute from "@/app/api/projects/[projectId]/scripts/[scriptId]/fix/route";
import * as scriptRoute from "@/app/api/projects/[projectId]/scripts/[scriptId]/route";
import * as versionsRoute from "@/app/api/projects/[projectId]/scripts/[scriptId]/versions/route";
import * as downloadRoute from "@/app/api/projects/[projectId]/scripts/download/route";
import * as scriptsRoute from "@/app/api/projects/[projectId]/scripts/route";
import * as targetRoute from "@/app/api/projects/[projectId]/targets/[targetId]/route";
import * as targetsRoute from "@/app/api/projects/[projectId]/targets/route";
import * as tcRoute from "@/app/api/projects/[projectId]/test-cases/[testCaseId]/route";
import { getFakeProvider } from "@/server/ai/provider";
import { db } from "@/server/db";
import { getRunBus, type MemoryRunBus } from "@/server/runs/bus";
import { setEgress } from "@/server/sandbox/egress";
import { setSandbox } from "@/server/sandbox/sandbox";
import { getStorage } from "@/server/storage/storage";
import { call, createProject, jsonOf, userWithSession, type Session } from "../support/api";
import { FakeSandbox } from "../support/fake-sandbox";
import { runJob, runQueued } from "../support/jobs";

let tester: Session;
let viewer: Session;
let lead: Session;
let projectId: string;
let sandbox: FakeSandbox;

const PASSWORD = "Sup3r-Secret-Pw!";

beforeEach(async () => {
  const t = await userWithSession("QA_TESTER");
  const v = await userWithSession("VIEWER");
  const a = await userWithSession("ADMIN");
  tester = t.session;
  viewer = v.session;
  lead = a.session;
  projectId = (await createProject("Shop", [t.user.id, v.user.id], a.user.id)).id;
  sandbox = new FakeSandbox();
  setSandbox(sandbox);
  setEgress({
    grant: async () => ({
      proxy: { server: "http://127.0.0.1:9", username: "run", password: "egress-token-xyz" },
      revoke: async () => undefined,
    }),
  });
});

async function approvedTarget(origin = "https://staging.example.com") {
  const req = await call(targetsRoute.POST, "/", {
    session: tester,
    params: { projectId },
    json: { url: origin },
  });
  expect(req.status).toBe(201);
  const { target } = await jsonOf<{ target: { id: string } }>(req);
  const ok = await call(targetRoute.PATCH, "/", {
    method: "PATCH",
    session: lead,
    params: { projectId, targetId: target.id },
    json: { decision: "APPROVE" },
  });
  expect(ok.status).toBe(200);
  return target.id;
}

async function environment(withLogin = true) {
  const targetId = await approvedTarget();
  const res = await call(envsRoute.POST, "/", {
    session: tester,
    params: { projectId },
    json: {
      name: "Staging",
      targetId,
      variables: [{ name: "SHOP_NAME", value: "Demo" }],
      ...(withLogin
        ? {
            loginConfig: {
              path: "/login",
              usernameLabel: "Email",
              passwordLabel: "Password",
              submitLabel: "Sign in",
            },
          }
        : {}),
    },
  });
  expect(res.status).toBe(201);
  const { environment: env } = await jsonOf<{ environment: { id: string } }>(res);
  if (withLogin) {
    const acc = await call(accountsRoute.POST, "/", {
      session: tester,
      params: { projectId, environmentId: env.id },
      json: { label: "Standard user", username: "ana@shop.test", password: PASSWORD },
    });
    expect(acc.status).toBe(201);
  }
  return env.id;
}

async function verify(environmentId: string) {
  const res = await call(verifyRoute.POST, "/", {
    session: tester,
    params: { projectId, environmentId },
  });
  expect(res.status).toBe(202);
  const { job } = await jsonOf<{ job: { id: string } }>(res);
  return runJob(job.id);
}

let caseNo = 0;
async function approvedCase(
  title: string,
  steps: { action: string; expected: string | null }[] = [{ action: "Open /cart", expected: null }],
) {
  caseNo++;
  const key = `TC-${String(caseNo).padStart(3, "0")}`;
  return db.testCase.create({
    data: {
      projectId,
      key,
      title,
      preconditions: "None",
      steps,
      testData: { none: "not needed" },
      expectedResult: "It works",
      type: "POSITIVE",
      priority: "HIGH",
      automatable: true,
      automatableReason: "UI steps",
      origin: "MANUAL",
      status: "APPROVED",
      tags: ["smoke"],
    },
  });
}

async function generate(environmentId: string, testCaseIds?: string[]) {
  const res = await call(scriptsRoute.POST, "/", {
    session: tester,
    params: { projectId },
    json: { environmentId, ...(testCaseIds ? { testCaseIds } : {}) },
  });
  expect(res.status).toBe(202);
  const { job } = await jsonOf<{ job: { id: string } }>(res);
  return runJob(job.id);
}

async function approveLatest(scriptId: string) {
  const latest = await db.scriptVersion.findFirstOrThrow({
    where: { scriptId },
    orderBy: { version: "desc" },
  });
  return call(approvalRoute.POST, "/", {
    session: tester,
    params: { projectId, scriptId },
    json: { versionId: latest.id },
  });
}

/** Environment verified, cases scripted and approved: ready to run. */
async function readyToRun(codes: string[] = ["ok"]) {
  const envId = await environment();
  expect(await verify(envId)).toEqual({ outcome: "succeeded" });
  const cases = [];
  for (const c of codes) cases.push(await approvedCase(`Case ${c}`));
  expect(await generate(envId)).toEqual({ outcome: "succeeded" });
  for (const [i, tc] of cases.entries()) {
    const script = await db.script.findUniqueOrThrow({ where: { testCaseId: tc.id } });
    if (codes[i] !== "ok") {
      const latest = await db.scriptVersion.findFirstOrThrow({
        where: { scriptId: script.id },
        orderBy: { version: "desc" },
      });
      const res = await call(versionsRoute.POST, "/", {
        session: tester,
        params: { projectId, scriptId: script.id },
        json: { code: `${latest.code}\n// ${codes[i]}\n` },
      });
      expect(res.status).toBe(201);
    }
    expect((await approveLatest(script.id)).status).toBe(200);
  }
  return { envId, cases };
}

async function startRun(envId: string, extra: Record<string, unknown> = {}) {
  const res = await call(runsRoute.POST, "/", {
    session: tester,
    params: { projectId },
    json: { environmentId: envId, ...extra },
  });
  return res;
}

describe("environments (FR-7, FRD step 5)", () => {
  it("is Unverified until the sign-in check passes; the session is stored encrypted", async () => {
    const envId = await environment();
    let env = await db.environment.findUniqueOrThrow({ where: { id: envId } });
    expect(env.verifiedAt).toBeNull();

    expect(await verify(envId)).toEqual({ outcome: "succeeded" });
    env = await db.environment.findUniqueOrThrow({ where: { id: envId } });
    expect(env.verifiedAt).not.toBeNull();
    expect(env.loginCheckStatus).toBe("OK");
    const stored = (await getStorage().get(env.storageStateKey!)).toString("utf8");
    expect(stored).not.toContain("session");
    expect(stored).toMatch(/^v1:/);

    // The sandbox got the credentials; nothing returned to the browser contains them.
    expect(sandbox.inputs[0]?.accounts["Standard user"]?.password).toBe(PASSWORD);
    const list = await call(envsRoute.GET, "/", { session: tester, params: { projectId } });
    expect(await list.text()).not.toContain(PASSWORD);

    // A new password makes it Unverified again.
    const acc = await db.testAccount.findFirstOrThrow({ where: { environmentId: envId } });
    await call(accountRoute.PATCH, "/", {
      method: "PATCH",
      session: tester,
      params: { projectId, environmentId: envId, accountId: acc.id },
      json: { password: "An0ther-Pw-123" },
    });
    env = await db.environment.findUniqueOrThrow({ where: { id: envId } });
    expect(env.verifiedAt).toBeNull();
    expect(env.storageStateKey).toBeNull();
  });

  it("stays Unverified with the reason when sign-in fails, and blocks runs", async () => {
    const envId = await environment();
    sandbox.loginOk = false;
    const out = await verify(envId);
    expect(out.outcome).toBe("failed");
    const env = await db.environment.findUniqueOrThrow({ where: { id: envId } });
    expect(env).toMatchObject({ verifiedAt: null, loginCheckStatus: "FAILED" });
    expect(env.loginCheckError).toMatch(/Sign-in failed/);
    const run = await startRun(envId);
    expect(run.status).toBe(409);
    expect((await jsonOf<{ error: { message: string } }>(run)).error.message).toMatch(/Unverified/);
  });

  it("verifies an environment without sign-in by opening its start page", async () => {
    const envId = await environment(false);
    expect(await verify(envId)).toEqual({ outcome: "succeeded" });
    expect(sandbox.inputs[0]).toMatchObject({ mode: "capture", capture: { paths: ["/"] } });
    expect(
      (await db.environment.findUniqueOrThrow({ where: { id: envId } })).verifiedAt,
    ).not.toBeNull();
  });

  it("only approved addresses can back an environment; viewers can't add one", async () => {
    const req = await call(targetsRoute.POST, "/", {
      session: tester,
      params: { projectId },
      json: { url: "https://pending.example.com" },
    });
    const { target } = await jsonOf<{ target: { id: string } }>(req);
    const env = await call(envsRoute.POST, "/", {
      session: tester,
      params: { projectId },
      json: { name: "Pending", targetId: target.id },
    });
    expect(env.status).toBe(409);
    const asViewer = await call(envsRoute.POST, "/", {
      session: viewer,
      params: { projectId },
      json: { name: "X", targetId: target.id },
    });
    expect(asViewer.status).toBe(403);
    // Testers can't approve addresses.
    const selfApprove = await call(targetRoute.PATCH, "/", {
      method: "PATCH",
      session: tester,
      params: { projectId, targetId: target.id },
      json: { decision: "APPROVE" },
    });
    expect(selfApprove.status).toBe(403);
  });

  it("shared environments: the Lead creates them, every project can use them, testers can't edit", async () => {
    const t = await call(adminTargetsRoute.POST, "/", {
      session: lead,
      json: { url: "https://uat.example.com" },
    });
    expect(t.status).toBe(201);
    const { target } = await jsonOf<{ target: { id: string } }>(t);
    expect(
      (
        await call(adminTargetsRoute.POST, "/", {
          session: tester,
          json: { url: "https://x.example.com" },
        })
      ).status,
    ).toBe(403);
    const created = await call(adminEnvsRoute.POST, "/", {
      session: lead,
      json: { name: "Shared UAT", targetId: target.id },
    });
    expect(created.status).toBe(201);
    const { environment: shared } = await jsonOf<{ environment: { id: string } }>(created);

    const list = await jsonOf<{ environments: { id: string; shared: boolean }[] }>(
      await call(envsRoute.GET, "/", { session: tester, params: { projectId } }),
    );
    expect(list.environments).toEqual([expect.objectContaining({ id: shared.id, shared: true })]);
    // Not editable through a project…
    const edit = await call(envRoute.PATCH, "/", {
      method: "PATCH",
      session: tester,
      params: { projectId, environmentId: shared.id },
      json: { name: "Mine now" },
    });
    expect(edit.status).toBe(404);
    // …but a project can check it and use it.
    expect(await verify(shared.id)).toEqual({ outcome: "succeeded" });
    const tc = await approvedCase("Shared env case");
    expect(await generate(shared.id, [tc.id])).toEqual({ outcome: "succeeded" });
  });
});

describe("scripts (FR-5.1, FR-6)", () => {
  it("writes scripts only for approved, automatable cases, from the captured pages", async () => {
    const envId = await environment();
    await verify(envId);
    const draft = await approvedCase("Draft case");
    await db.testCase.update({ where: { id: draft.id }, data: { status: "DRAFT" } });
    const res = await call(scriptsRoute.POST, "/", {
      session: tester,
      params: { projectId },
      json: { environmentId: envId, testCaseIds: [draft.id] },
    });
    expect(res.status).toBe(409);

    const tc = await approvedCase("Add to cart", [
      { action: "Open /cart", expected: null },
      { action: "Go to /checkout and pay", expected: "Paid" },
    ]);
    expect(await generate(envId, [tc.id])).toEqual({ outcome: "succeeded" });
    // Each page of the flow was captured (FRD step 4).
    const capture = sandbox.inputs.find((i) => i.mode === "capture");
    expect(capture?.capture?.paths).toEqual(["/", "/cart", "/checkout"]);
    // The AI saw labels and pages, never the credentials.
    const prompt = getFakeProvider().calls.find((c) => c.purpose === "GENERATE_SCRIPT")!;
    const text = prompt.content.map((p) => (p.type === "text" ? p.text : "")).join("");
    expect(text).toContain('"Standard user"');
    expect(text).toContain("captured page 3");
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain("ana@shop.test");
    expect(prompt.promptVersion).toBe("script-generation@1");

    const script = await db.script.findUniqueOrThrow({
      where: { testCaseId: tc.id },
      include: { versions: true },
    });
    expect(script).toMatchObject({ status: "DRAFT", needsEdit: false });
    expect(script.versions[0]).toMatchObject({
      typeCheckOk: true,
      safetyCheckOk: true,
      source: "AI_GENERATED",
    });
  });

  it("regenerates once on a compile error, then marks the script 'needs edit'", async () => {
    const envId = await environment();
    await verify(envId);
    const tc = await approvedCase("Broken");
    const bad = {
      code: 'import { test } from "./traxion";\ntest("x", async ({ page }) => { page.nope(); });',
      notes: "",
    };
    getFakeProvider().queue.push(bad, bad);
    expect(await generate(envId, [tc.id])).toEqual({ outcome: "succeeded" });
    const script = await db.script.findUniqueOrThrow({ where: { testCaseId: tc.id } });
    expect(script.needsEdit).toBe(true);
    expect(getFakeProvider().calls.filter((c) => c.purpose === "FIX_SCRIPT")).toHaveLength(1);
    // A version with errors can't be approved.
    expect((await approveLatest(script.id)).status).toBe(409);
    const list = await jsonOf<{ scripts: { state: string }[] }>(
      await call(scriptsRoute.GET, "/", { session: viewer, params: { projectId } }),
    );
    expect(list.scripts[0]?.state).toBe("NEEDS_EDIT");

    // "Ask AI to fix" produces a new version for review.
    getFakeProvider().queue.push({
      code: 'import { test, expect } from "./traxion";\ntest("x", async ({ page }) => {\n  await page.goto("/");\n  await expect(page.locator("body")).toBeVisible();\n});\n',
      notes: "Removed the unknown call.",
    });
    const fix = await call(fixRoute.POST, "/", {
      session: tester,
      params: { projectId, scriptId: script.id },
      json: { instruction: "Make it compile" },
    });
    expect(fix.status).toBe(202);
    const { job } = await jsonOf<{ job: { id: string } }>(fix);
    expect(await runJob(job.id)).toEqual({ outcome: "succeeded" });
    expect((await db.script.findUniqueOrThrow({ where: { id: script.id } })).needsEdit).toBe(false);
    expect((await approveLatest(script.id)).status).toBe(200);
  });

  it("an edit is a new version that must be approved again; editing the case withdraws approval", async () => {
    const { cases } = await readyToRun();
    const tc = cases[0]!;
    const script = await db.script.findUniqueOrThrow({ where: { testCaseId: tc.id } });
    expect(script.status).toBe("APPROVED");
    expect((await db.testCase.findUniqueOrThrow({ where: { id: tc.id } })).status).toBe("SCRIPTED");

    const detail = await jsonOf<{ script: { versions: { code: string }[] } }>(
      await call(scriptRoute.GET, "/", {
        session: tester,
        params: { projectId, scriptId: script.id },
      }),
    );
    const edit = await call(versionsRoute.POST, "/", {
      session: tester,
      params: { projectId, scriptId: script.id },
      json: { code: `${detail.script.versions[0]!.code}\n// tester note\n` },
    });
    expect(edit.status).toBe(201);
    let after = await db.script.findUniqueOrThrow({ where: { id: script.id } });
    expect(after).toMatchObject({ status: "DRAFT", approvedVersionId: null });
    expect((await db.testCase.findUniqueOrThrow({ where: { id: tc.id } })).status).toBe("APPROVED");
    expect((await approveLatest(script.id)).status).toBe(200);

    // Editing the test case sends it to Draft and withdraws the script approval.
    await call(tcRoute.PATCH, "/", {
      method: "PATCH",
      session: tester,
      params: { projectId, testCaseId: tc.id },
      json: { title: "Changed title" },
    });
    after = await db.script.findUniqueOrThrow({ where: { id: script.id } });
    expect(after.approvedVersionId).toBeNull();
  });

  it("downloads approved scripts as a Playwright project without credentials", async () => {
    await readyToRun();
    const res = await call(downloadRoute.GET, "/", { session: viewer, params: { projectId } });
    expect(res.status).toBe(200);
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining([
        "package.json",
        "playwright.config.ts",
        "tests/traxion.ts",
        "secrets.example.json",
        "README.md",
      ]),
    );
    expect(Object.keys(files).some((f) => f.endsWith(".spec.ts"))).toBe(true);
    const all = Object.values(files)
      .map((f) => strFromU8(f))
      .join("\n");
    expect(all).not.toContain(PASSWORD);
    expect(all).not.toContain("ana@shop.test");
  });
});

describe("runs (FR-8, FRD step 6)", () => {
  it("runs approved scripts in parallel and records steps, console, network and artifacts", async () => {
    const { envId, cases } = await readyToRun(["ok", "WILL_FAIL", "WILL_TIME_OUT"]);
    const res = await startRun(envId, { timeoutSeconds: 30, retries: 1 });
    expect(res.status).toBe(201);
    const { run } = await jsonOf<{ run: { id: string } }>(res);
    expect(await runQueued(projectId, "EXECUTE_RUN")).toEqual([{ outcome: "succeeded" }]);

    // NFR-8: one sandbox per test here (3 tests, up to 5 workers).
    const runInputs = sandbox.inputs.filter((i) => i.mode === "run");
    expect(runInputs).toHaveLength(3);
    expect(runInputs[0]).toMatchObject({ testTimeoutMs: 30_000, retries: 1 });

    const detail = await jsonOf<{
      run: {
        status: string;
        number: number;
        counts: { passed: number; failed: number; errors: number };
        tests: {
          id: string;
          key: string;
          status: string;
          attempts: number;
          error: string | null;
          has: Record<string, boolean>;
          steps: { id: string; hasScreenshot: boolean }[];
        }[];
      };
    }>(await call(runRoute.GET, "/", { session: viewer, params: { projectId, runId: run.id } }));
    expect(detail.run).toMatchObject({
      status: "FAILED",
      number: 1,
      counts: { passed: 1, failed: 1, errors: 1 },
    });
    const byKey = Object.fromEntries(detail.run.tests.map((t) => [t.key, t]));
    expect(byKey[cases[0]!.key]).toMatchObject({ status: "PASSED", attempts: 1 });
    expect(byKey[cases[1]!.key]).toMatchObject({ status: "FAILED", attempts: 2 });
    // FR-8.4: a timed-out case is marked Error.
    expect(byKey[cases[2]!.key]?.status).toBe("ERROR");
    expect(byKey[cases[2]!.key]?.error).toMatch(/Timed out after 30 s/);
    // Only the final attempt's steps are kept.
    expect(byKey[cases[1]!.key]?.steps).toHaveLength(1);
    const passed = byKey[cases[0]!.key]!;
    expect(passed.has).toMatchObject({ trace: true, console: true, network: true });
    expect(passed.steps[0]?.hasScreenshot).toBe(true);

    // Case statuses follow the results (FRD lifecycle).
    expect((await db.testCase.findUniqueOrThrow({ where: { id: cases[0]!.id } })).status).toBe(
      "PASSED",
    );
    expect((await db.testCase.findUniqueOrThrow({ where: { id: cases[1]!.id } })).status).toBe(
      "FAILED",
    );

    // Artifacts and step screenshots, for members only.
    const con = await call(artifactRoute.GET, "/", {
      session: viewer,
      params: { projectId, runId: run.id, runTestId: passed.id, kind: "console" },
    });
    expect(con.status).toBe(200);
    expect(await con.text()).toContain("app ready");
    const shot = await call(stepShotRoute.GET, "/", {
      session: tester,
      params: { projectId, runId: run.id, stepId: passed.steps[0]!.id },
    });
    expect(shot.headers.get("content-type")).toBe("image/jpeg");
    const other = await createProject("Other", [], (await userWithSession("ADMIN")).user.id);
    const outsider = await userWithSession("QA_TESTER");
    await db.projectMember.create({ data: { projectId: other.id, userId: outsider.user.id } });
    const cross = await call(artifactRoute.GET, "/", {
      session: outsider.session,
      params: { projectId: other.id, runId: run.id, runTestId: passed.id, kind: "console" },
    });
    expect(cross.status).toBe(404);

    // The live view received events, and none carries the password.
    const bus = getRunBus() as MemoryRunBus;
    const events = bus.published.filter((p) => p.runId === run.id).map((p) => p.event.type);
    expect(events).toEqual(
      expect.arrayContaining(["run", "test", "step", "frame", "console", "net", "end"]),
    );
    expect(JSON.stringify(bus.published)).not.toContain(PASSWORD);
  });

  it("selects cases by tag or scenario, and refuses cases without an approved script", async () => {
    const { envId } = await readyToRun(["ok"]);
    const unscripted = await approvedCase("No script yet");
    const byCases = await startRun(envId, {
      selection: { kind: "cases", testCaseIds: [unscripted.id] },
    });
    expect(byCases.status).toBe(409);
    const byTag = await startRun(envId, { selection: { kind: "tag", tag: "nothing-has-this" } });
    expect(byTag.status).toBe(409);
    const ok = await startRun(envId, { selection: { kind: "tag", tag: "smoke" } });
    expect(ok.status).toBe(201);
    expect(await db.runTest.count()).toBe(1);
  });

  it("stop ends the run as Cancelled; untouched tests are skipped", async () => {
    const { envId } = await readyToRun(["ok", "ok", "ok", "ok", "ok", "ok"]);
    const res = await startRun(envId);
    const { run } = await jsonOf<{ run: { id: string } }>(res);
    let sent = false;
    sandbox.beforeTest = async () => {
      if (sent) return;
      sent = true;
      await db.run.update({ where: { id: run.id }, data: { status: "RUNNING" } });
      const stop = await call(controlRoute.POST, "/", {
        session: tester,
        params: { projectId, runId: run.id },
        json: { action: "stop" },
      });
      expect(stop.status).toBe(200);
    };
    await runQueued(projectId, "EXECUTE_RUN");
    const after = await db.run.findUniqueOrThrow({ where: { id: run.id } });
    expect(after.status).toBe("CANCELLED");
    expect(after.skippedCount).toBeGreaterThan(0);
    expect(sandbox.controls).toContain("stop");
  });

  it("a crashed worker aborts the run and keeps finished results", async () => {
    const { envId } = await readyToRun(["ok", "ok"]);
    const res = await startRun(envId);
    const { run } = await jsonOf<{ run: { id: string } }>(res);
    // Two workers: make only the second one crash.
    let starts = 0;
    const realStart = sandbox.start.bind(sandbox);
    sandbox.start = async (...args) => {
      starts++;
      sandbox.crashAfter = starts === 2 ? 0 : null;
      return realStart(...args);
    };
    await runQueued(projectId, "EXECUTE_RUN");
    const after = await db.run.findUniqueOrThrow({ where: { id: run.id } });
    expect(after.status).toBe("ABORTED");
    expect(after.passedCount).toBe(1);
    expect(after.skippedCount).toBe(1);
    expect(after.error).toMatch(/stopped unexpectedly/);
  });

  it("viewers can watch but not start or control runs", async () => {
    const { envId } = await readyToRun();
    const res = await call(runsRoute.POST, "/", {
      session: viewer,
      params: { projectId },
      json: { environmentId: envId },
    });
    expect(res.status).toBe(403);
    const list = await call(runsRoute.GET, "/", { session: viewer, params: { projectId } });
    expect(list.status).toBe(200);
  });
});
