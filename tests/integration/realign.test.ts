/**
 * FRD realignment (step 1): scenarios, case lifecycle, rewrite, regenerate, case export,
 * comments, requirement merge and review flags, file tags, AI settings and the dashboard.
 * In-process with the offline FakeProvider.
 */
import { beforeEach, describe, expect, it } from "vitest";
import readXlsxFile from "read-excel-file/node";
import * as settingsRoute from "@/app/api/admin/settings/ai/route";
import * as analysisRoute from "@/app/api/projects/[projectId]/analysis/route";
import * as commentsRoute from "@/app/api/projects/[projectId]/comments/route";
import * as docRoute from "@/app/api/projects/[projectId]/documents/[documentId]/route";
import * as docsRoute from "@/app/api/projects/[projectId]/documents/route";
import * as questionRoute from "@/app/api/projects/[projectId]/questions/[questionId]/route";
import * as mergeRoute from "@/app/api/projects/[projectId]/requirements/merge/route";
import * as reqsRoute from "@/app/api/projects/[projectId]/requirements/route";
import * as rewriteRoute from "@/app/api/projects/[projectId]/test-cases/[testCaseId]/rewrite/route";
import * as tcRoute from "@/app/api/projects/[projectId]/test-cases/[testCaseId]/route";
import * as exportRoute from "@/app/api/projects/[projectId]/test-cases/export/route";
import * as generateRoute from "@/app/api/projects/[projectId]/test-cases/generate/route";
import * as regenerateRoute from "@/app/api/projects/[projectId]/test-cases/regenerate/route";
import * as reviewRoute from "@/app/api/projects/[projectId]/test-cases/review/route";
import * as tcsRoute from "@/app/api/projects/[projectId]/test-cases/route";
import * as projectsRoute from "@/app/api/projects/route";
import { getAiBudget } from "@/server/ai/budget";
import { getFakeProvider } from "@/server/ai/provider";
import { db } from "@/server/db";
import { resetSettingsCache } from "@/server/services/settings";
import {
  call,
  createProject,
  fileForm,
  jsonOf,
  userWithSession,
  type Session,
} from "../support/api";
import { runJob, runQueued } from "../support/jobs";

let tester: Session;
let viewer: Session;
let admin: Session;
let projectId: string;

const FRD = [
  "Leave requests",
  "The employee shall submit a leave request with a start and end date.",
  "The manager must approve or reject the request within 3 days.",
  "The end date must not be before the start date.",
].join("\n");

beforeEach(async () => {
  resetSettingsCache();
  const t = await userWithSession("QA_TESTER");
  const v = await userWithSession("VIEWER");
  const a = await userWithSession("ADMIN");
  tester = t.session;
  viewer = v.session;
  admin = a.session;
  projectId = (await createProject("Leave Portal", [t.user.id, v.user.id], a.user.id)).id;
});

async function jobOf(res: Response) {
  expect(res.status).toBe(202);
  return (await jsonOf<{ job: { id: string } }>(res)).job;
}

async function seed() {
  const up = await call(docsRoute.POST, "/", {
    session: tester,
    params: { projectId },
    form: fileForm("REQUIREMENTS", "leave-frd.txt", FRD),
  });
  expect(up.status).toBe(201);
  await runQueued(projectId, "EXTRACT_TEXT");
  const a = await jobOf(
    await call(analysisRoute.POST, "/", { method: "POST", session: tester, params: { projectId } }),
  );
  expect(await runJob(a.id)).toEqual({ outcome: "succeeded" });
  const g = await jobOf(
    await call(generateRoute.POST, "/", { session: tester, params: { projectId }, json: {} }),
  );
  expect(await runJob(g.id)).toEqual({ outcome: "succeeded" });
  return db.testCase.findMany({ where: { projectId }, orderBy: { key: "asc" } });
}

describe("generation with scenarios (FR-4)", () => {
  it("groups generated cases into scenarios with every field and tags filled", async () => {
    const cases = await seed();
    const scenarios = await db.scenario.findMany({ where: { projectId } });
    expect(scenarios.map((s) => s.key)).toEqual(["SC-001"]);
    expect(cases.length).toBeGreaterThan(0);
    for (const c of cases) {
      expect(c.scenarioId).toBe(scenarios[0]!.id);
      expect(c.preconditions).toBeTruthy();
      expect(c.automatableReason).toBeTruthy();
      expect(Object.keys(c.testData as object).length).toBeGreaterThan(0);
      expect(c.tags.length).toBeGreaterThan(0);
    }
    const job = await db.job.findFirstOrThrow({
      where: { projectId, type: "GENERATE_TEST_CASES" },
    });
    expect(job.result).toMatchObject({ scenariosAdded: 1, partial: false, notCovered: [] });
    const usage = await db.aiUsage.findFirstOrThrow({
      where: { projectId, purpose: "GENERATE_TEST_CASES" },
    });
    expect(usage.promptVersion).toBe("test-case-generation@2");

    // A second generation for the same requirements reuses the existing scenario.
    const reqs = await db.requirement.findMany({ where: { projectId } });
    await db.testCase.updateMany({ where: { projectId }, data: { title: "renamed" } });
    const g = await jobOf(
      await call(generateRoute.POST, "/", {
        session: tester,
        params: { projectId },
        json: { requirementIds: reqs.map((r) => r.id) },
      }),
    );
    expect(await runJob(g.id)).toEqual({ outcome: "succeeded" });
    expect(await db.scenario.count({ where: { projectId } })).toBe(1);
  });

  it("filters cases by scenario, type, tag and Manual only", async () => {
    const cases = await seed();
    await db.testCase.update({ where: { id: cases[0]!.id }, data: { automatable: false } });
    const list = async (q: string) =>
      (
        await jsonOf<{ testCases: { key: string }[] }>(
          await call(tcsRoute.GET, `/x?${q}`, { session: viewer, params: { projectId } }),
        )
      ).testCases.map((t) => t.key);
    expect(await list("manual=1")).toEqual([cases[0]!.key]);
    expect((await list("type=NEGATIVE")).length).toBe(
      cases.filter((c) => c.type === "NEGATIVE").length,
    );
    expect((await list("tag=smoke")).length).toBe(
      cases.filter((c) => c.tags.includes("smoke")).length,
    );
    const sc = await db.scenario.findFirstOrThrow({ where: { projectId } });
    expect((await list(`scenarioId=${sc.id}`)).length).toBe(cases.length);
  });
});

describe("test case lifecycle", () => {
  it("never downgrades scripted or run cases, and a rejected case must be reopened first", async () => {
    const [a, b, c] = await seed();
    await db.testCase.update({ where: { id: a!.id }, data: { status: "PASSED" } });
    const review = (ids: string[], decision: string, reason?: string) =>
      call(reviewRoute.POST, "/", {
        session: tester,
        params: { projectId },
        json: { testCaseIds: ids, decision, ...(reason ? { reason } : {}) },
      });

    // "Approve all": the passed case is left alone, the draft is approved.
    const all = await review([a!.id, b!.id], "APPROVE");
    expect(await jsonOf(all)).toEqual({ updated: 1 });
    expect((await db.testCase.findUniqueOrThrow({ where: { id: a!.id } })).status).toBe("PASSED");
    expect((await db.testCase.findUniqueOrThrow({ where: { id: b!.id } })).status).toBe("APPROVED");

    expect((await review([c!.id], "REJECT", "Not needed")).status).toBe(200);
    const blocked = await review([c!.id], "APPROVE");
    expect(blocked.status).toBe(409);
    expect((await review([c!.id], "REOPEN")).status).toBe(200);
    expect((await review([c!.id], "APPROVE")).status).toBe(200);

    // The audit log records each status change.
    const log = await db.auditLog.findFirstOrThrow({
      where: { projectId, action: "testcase.reject", entityId: c!.id },
    });
    expect(log.before).toEqual({ status: "DRAFT" });
    expect(log.after).toEqual({ status: "REJECTED" });
  });

  it("an edit records who changed what, before and after", async () => {
    const [a] = await seed();
    const edit = await call(tcRoute.PATCH, "/", {
      method: "PATCH",
      session: tester,
      params: { projectId, testCaseId: a!.id },
      json: { title: "Submit a leave request for next week", tags: ["Leave", "smoke"] },
    });
    expect(edit.status).toBe(200);
    const { testCase } = await jsonOf<{
      testCase: { updatedBy: string; tags: string[]; sources: unknown[] };
    }>(edit);
    expect(testCase.tags).toEqual(["leave", "smoke"]);
    expect(testCase.updatedBy).toBe("QA_TESTER user");
    // NFR-7: each linked requirement cites its source document.
    expect(testCase.sources).toEqual([expect.objectContaining({ document: "leave-frd.txt" })]);
    const log = await db.auditLog.findFirstOrThrow({
      where: { projectId, action: "testcase.update" },
    });
    expect(log.before).toMatchObject({ title: a!.title });
    expect(log.after).toMatchObject({ title: "Submit a leave request for next week" });
  });
});

describe("AI rewrite of one case", () => {
  it("proposes a rewrite; accepting it updates the case and sends it back to Draft", async () => {
    const [a] = await seed();
    await call(reviewRoute.POST, "/", {
      session: tester,
      params: { projectId },
      json: { testCaseIds: [a!.id], decision: "APPROVE" },
    });
    const job = await jobOf(
      await call(rewriteRoute.POST, "/", {
        session: tester,
        params: { projectId, testCaseId: a!.id },
        json: { instruction: "Use a half-day leave" },
      }),
    );
    // A second request while the first runs is refused.
    expect(
      (
        await call(rewriteRoute.POST, "/", {
          session: tester,
          params: { projectId, testCaseId: a!.id },
          json: { instruction: "Again" },
        })
      ).status,
    ).toBe(409);
    expect(await runJob(job.id)).toEqual({ outcome: "succeeded" });
    // The proposal alone changes nothing.
    expect((await db.testCase.findUniqueOrThrow({ where: { id: a!.id } })).status).toBe("APPROVED");
    const prompt = getFakeProvider().calls.at(-1)!;
    const text = prompt.content.map((p) => (p.type === "text" ? p.text : "")).join("");
    expect(text).toMatch(/source="tester instruction">>>\nUse a half-day leave/);

    const accept = await call(rewriteRoute.PUT, "/", {
      method: "PUT",
      session: tester,
      params: { projectId, testCaseId: a!.id },
      json: { jobId: job.id },
    });
    expect(accept.status).toBe(200);
    const after = await db.testCase.findUniqueOrThrow({ where: { id: a!.id } });
    expect(after.title).toMatch(/rewritten: Use a half-day leave/);
    expect(after.status).toBe("DRAFT");
    expect(await db.auditLog.count({ where: { projectId, action: "testcase.rewrite" } })).toBe(1);

    // Applying the same proposal again would overwrite a newer version: refused.
    const again = await call(rewriteRoute.PUT, "/", {
      method: "PUT",
      session: tester,
      params: { projectId, testCaseId: a!.id },
      json: { jobId: job.id },
    });
    expect(again.status).toBe(409);
  });

  it("viewers can't ask for or apply rewrites", async () => {
    const [a] = await seed();
    expect(
      (
        await call(rewriteRoute.POST, "/", {
          session: viewer,
          params: { projectId, testCaseId: a!.id },
          json: { instruction: "Shorter" },
        })
      ).status,
    ).toBe(403);
  });
});

describe("regenerate rejected cases (FR-4.5)", () => {
  it("writes replacements using the rejection reason", async () => {
    const [a] = await seed();
    const before = await db.testCase.count({ where: { projectId } });
    expect(
      (await call(regenerateRoute.POST, "/", { session: tester, params: { projectId }, json: {} }))
        .status,
    ).toBe(409); // nothing rejected yet
    await call(reviewRoute.POST, "/", {
      session: tester,
      params: { projectId },
      json: { testCaseIds: [a!.id], decision: "REJECT", reason: "Steps are too vague" },
    });
    // Make room for a new title so the replacement isn't skipped as a duplicate.
    await db.testCase.updateMany({
      where: { projectId, status: { not: "REJECTED" } },
      data: { title: "other" },
    });
    const job = await jobOf(
      await call(regenerateRoute.POST, "/", {
        session: tester,
        params: { projectId },
        json: { testCaseIds: [a!.id] },
      }),
    );
    expect(await runJob(job.id)).toEqual({ outcome: "succeeded" });
    const prompt = getFakeProvider().calls.at(-1)!;
    const text = prompt.content.map((p) => (p.type === "text" ? p.text : "")).join("");
    expect(text).toContain("Rejected because: Steps are too vague");
    expect(await db.testCase.count({ where: { projectId } })).toBeGreaterThan(before);
    expect((await db.testCase.findUniqueOrThrow({ where: { id: a!.id } })).status).toBe("REJECTED");
  });
});

describe("test case export (FR-4.6)", () => {
  it("downloads every field as CSV and Excel, formula-safe", async () => {
    const [a] = await seed();
    await db.testCase.update({
      where: { id: a!.id },
      data: { title: '=HYPERLINK("http://evil")' },
    });
    const csv = await call(exportRoute.GET, "/x?format=csv", {
      session: viewer,
      params: { projectId },
    });
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-disposition")).toMatch(/Leave-Portal-test-cases\.csv/);
    expect(csv.headers.get("x-content-type-options")).toBe("nosniff");
    const text = (await csv.text()).replace(/^﻿/, "");
    const header = text.split("\r\n")[0]!;
    for (const col of ["Scenario", "Preconditions", "Test data", "Sources", "Tags"]) {
      expect(header).toContain(col);
    }
    expect(text).toContain(`"'=HYPERLINK(""http://evil"")"`);

    const xlsx = await call(exportRoute.GET, "/x?format=xlsx&manual=1", {
      session: tester,
      params: { projectId },
    });
    expect(xlsx.status).toBe(200);
    const sheets = await readXlsxFile(Buffer.from(await xlsx.arrayBuffer()));
    expect(sheets[0]?.data.length).toBe(1); // header only: no manual cases
    expect(await db.auditLog.count({ where: { projectId, action: "testcase.export" } })).toBe(2);
  });
});

describe("comments", () => {
  it("every member, viewers too, can comment on a case; foreign targets are not found", async () => {
    const [a] = await seed();
    const post = await call(commentsRoute.POST, "/", {
      session: viewer,
      params: { projectId },
      json: { targetType: "TEST_CASE", targetId: a!.id, body: "Is this still valid?" },
    });
    expect(post.status).toBe(201);
    const list = await jsonOf<{ comments: { body: string; author: { name: string } }[] }>(
      await call(commentsRoute.GET, `/x?targetType=TEST_CASE&targetId=${a!.id}`, {
        session: tester,
        params: { projectId },
      }),
    );
    expect(list.comments).toEqual([
      expect.objectContaining({ body: "Is this still valid?", author: expect.anything() }),
    ]);

    const other = await createProject("Other", [], (await userWithSession("ADMIN")).user.id);
    const foreign = await db.testCase.create({
      data: {
        projectId: other.id,
        key: "TC-001",
        title: "Foreign",
        steps: [],
        expectedResult: "x",
        type: "POSITIVE",
        priority: "LOW",
        automatable: false,
        origin: "MANUAL",
      },
    });
    const cross = await call(commentsRoute.POST, "/", {
      session: tester,
      params: { projectId },
      json: { targetType: "TEST_CASE", targetId: foreign.id, body: "Hi" },
    });
    expect(cross.status).toBe(404);
  });
});

describe("requirements (FR-3)", () => {
  it("flags requirements the AI asks about, and clears the flag once answered", async () => {
    await seed();
    const q = await db.openQuestion.findFirstOrThrow({ where: { projectId } });
    expect(q.requirementId).toBeTruthy();
    expect(
      (await db.requirement.findUniqueOrThrow({ where: { id: q.requirementId! } })).status,
    ).toBe("NEEDS_REVIEW");
    await call(questionRoute.PATCH, "/", {
      method: "PATCH",
      session: tester,
      params: { projectId, questionId: q.id },
      json: { answer: "Escalate to HR." },
    });
    expect(
      (await db.requirement.findUniqueOrThrow({ where: { id: q.requirementId! } })).status,
    ).toBe("ACTIVE");
  });

  it("merges duplicates: links and questions move to the survivor", async () => {
    await seed();
    const [r1, r2] = await db.requirement.findMany({
      where: { projectId },
      orderBy: { key: "asc" },
    });
    const r2Cases = await db.testCaseRequirement.count({ where: { requirementId: r2!.id } });
    const r1Cases = await db.testCaseRequirement.count({ where: { requirementId: r1!.id } });
    const merge = await call(mergeRoute.POST, "/", {
      session: tester,
      params: { projectId },
      json: {
        requirementIds: [r2!.id, r1!.id],
        text: "The employee submits a leave request that the manager handles within 3 days.",
        type: "FLOW",
      },
    });
    expect(merge.status).toBe(200);
    const survivor = await db.requirement.findUniqueOrThrow({ where: { id: r1!.id } });
    expect(survivor).toMatchObject({ type: "FLOW", updatedById: tester.userId });
    const merged = await db.requirement.findUniqueOrThrow({ where: { id: r2!.id } });
    expect(merged).toMatchObject({ status: "MERGED", mergedIntoId: r1!.id });
    expect(merged.deletedAt).not.toBeNull();
    expect(await db.testCaseRequirement.count({ where: { requirementId: r1!.id } })).toBe(
      r1Cases + r2Cases,
    );
    const list = await jsonOf<{ requirements: { id: string }[] }>(
      await call(reqsRoute.GET, "/", { session: tester, params: { projectId } }),
    );
    expect(list.requirements.map((r) => r.id)).not.toContain(r2!.id);
    const log = await db.auditLog.findFirstOrThrow({
      where: { projectId, action: "requirement.merge" },
    });
    expect(log.after).toMatchObject({ key: survivor.key, type: "FLOW" });
  });
});

describe("file tags (FR-2.3)", () => {
  it("moves a file to another group only if that group accepts its type", async () => {
    const up = await call(docsRoute.POST, "/", {
      session: tester,
      params: { projectId },
      form: fileForm("REQUIREMENTS", "notes.txt", "The user shall log in."),
    });
    const { document } = await jsonOf<{ document: { id: string; typeTag: string } }>(up);
    expect(document.typeTag).toBe("FRD");
    const patch = (typeTag: string) =>
      call(docRoute.PATCH, "/", {
        method: "PATCH",
        session: tester,
        params: { projectId, documentId: document.id },
        json: { typeTag },
      });
    expect((await patch("USER_STORY")).status).toBe(200);
    // A text file can't be a flow diagram (that group takes images and PDFs).
    expect((await patch("FLOW_DIAGRAM")).status).toBe(400);
    const viewerPatch = await call(docRoute.PATCH, "/", {
      method: "PATCH",
      session: viewer,
      params: { projectId, documentId: document.id },
      json: { typeTag: "OTHER" },
    });
    expect(viewerPatch.status).toBe(403);
    const row = await db.document.findUniqueOrThrow({ where: { id: document.id } });
    expect(row).toMatchObject({ typeTag: "USER_STORY", category: "REQUIREMENTS" });
    const log = await db.auditLog.findFirstOrThrow({
      where: { projectId, action: "document.update" },
    });
    expect(log.before).toEqual({ typeTag: "FRD" });
    expect(log.after).toEqual({ typeTag: "USER_STORY" });
  });

  it("tags every analysed block, so the AI reads it in context", async () => {
    await seed();
    const call0 = getFakeProvider().calls.find((c) => c.purpose === "ANALYZE_REQUIREMENTS")!;
    const text = call0.content.map((p) => (p.type === "text" ? p.text : "")).join("");
    expect(text).toContain('source="DOC-1 [FRD]: leave-frd.txt"');
  });
});

describe("AI settings (Lead only)", () => {
  it("stores the model and default cap; budget and display use them", async () => {
    expect((await call(settingsRoute.GET, "/", { session: tester })).status).toBe(403);
    const patch = await call(settingsRoute.PATCH, "/", {
      method: "PATCH",
      session: tester,
      json: { defaultMonthlyTokenCap: 5000 },
    });
    expect(patch.status).toBe(403);

    const ok = await call(settingsRoute.PATCH, "/", {
      method: "PATCH",
      session: admin,
      json: { model: "gpt-test-1", defaultMonthlyTokenCap: 5000 },
    });
    expect(ok.status).toBe(200);
    const { settings } = await jsonOf<{
      settings: { effectiveModel: string; effectiveDefaultCap: number; apiKeyConfigured: boolean };
    }>(ok);
    expect(settings).toMatchObject({ effectiveModel: "gpt-test-1", effectiveDefaultCap: 5000 });
    expect(JSON.stringify(settings)).not.toMatch(/sk-/); // the key itself is never returned
    expect((await getAiBudget(projectId)).cap).toBe(5000);

    const bad = await call(settingsRoute.PATCH, "/", {
      method: "PATCH",
      session: admin,
      json: { model: "gpt test; rm -rf" },
    });
    expect(bad.status).toBe(422);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "settings.update" } });
    expect(log.after).toEqual({ model: "gpt-test-1", defaultMonthlyTokenCap: 5000 });
  });
});

describe("projects dashboard", () => {
  it("shows owner, stage, counts and the summary tiles", async () => {
    const empty = await jsonOf<{
      projects: { id: string; stage: string; owner: { name: string } }[];
    }>(await call(projectsRoute.GET, "/", { session: tester }));
    expect(empty.projects[0]).toMatchObject({
      stage: "NOT_STARTED",
      owner: { name: "ADMIN user" },
    });

    await seed();
    const res = await jsonOf<{
      projects: { stage: string; draftCount: number; testCaseCount: number; lastPassRate: null }[];
      stats: { activeProjects: number; awaitingReview: number; averagePassRate: null };
    }>(await call(projectsRoute.GET, "/", { session: tester }));
    expect(res.projects[0]).toMatchObject({ stage: "REVIEWING", lastPassRate: null });
    expect(res.projects[0]!.draftCount).toBe(res.projects[0]!.testCaseCount);
    expect(res.stats).toMatchObject({
      activeProjects: 1,
      awaitingReview: res.projects[0]!.draftCount,
      averagePassRate: null,
    });
  });
});
