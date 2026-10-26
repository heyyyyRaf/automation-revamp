/**
 * Phase 2 routes: every requirement / question / test case / export / job route is scoped to the
 * caller's project, and roles are enforced server-side.
 */
import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";
import * as budgetRoute from "@/app/api/projects/[projectId]/ai-budget/route";
import * as analysisRoute from "@/app/api/projects/[projectId]/analysis/route";
import * as docsRoute from "@/app/api/projects/[projectId]/documents/route";
import * as exportFileRoute from "@/app/api/projects/[projectId]/exports/[exportId]/file/route";
import * as exportsRoute from "@/app/api/projects/[projectId]/exports/route";
import * as flowRoute from "@/app/api/projects/[projectId]/flows/[flowId]/route";
import * as jobsRoute from "@/app/api/projects/[projectId]/jobs/route";
import * as questionRoute from "@/app/api/projects/[projectId]/questions/[questionId]/route";
import * as reqRoute from "@/app/api/projects/[projectId]/requirements/[requirementId]/route";
import * as reqsRoute from "@/app/api/projects/[projectId]/requirements/route";
import * as tcRoute from "@/app/api/projects/[projectId]/test-cases/[testCaseId]/route";
import * as generateRoute from "@/app/api/projects/[projectId]/test-cases/generate/route";
import * as reviewRoute from "@/app/api/projects/[projectId]/test-cases/review/route";
import * as tcsRoute from "@/app/api/projects/[projectId]/test-cases/route";
import { db } from "@/server/db";
import { resetEnvCache } from "@/server/env";
import { setFigmaFetch } from "@/server/figma/figma";
import { call, createProject, jsonOf, userWithSession, type Session } from "../support/api";
import { runQueued } from "../support/jobs";

let alice: Session; // tester on A
let bob: Session; // tester on B
let viewer: Session; // viewer on A
let projectA: string;
let projectB: string;
let reqA: string;
let tcA: string;
let flowA: string;
let questionA: string;

beforeEach(async () => {
  const a = await userWithSession("QA_TESTER");
  const b = await userWithSession("QA_TESTER");
  const v = await userWithSession("VIEWER");
  alice = a.session;
  bob = b.session;
  viewer = v.session;
  projectA = (await createProject("A", [a.user.id, v.user.id])).id;
  projectB = (await createProject("B", [b.user.id])).id;
  const req = await db.requirement.create({
    data: {
      projectId: projectA,
      key: "REQ-001",
      text: "Secret requirement of A",
      type: "FEATURE",
      origin: "MANUAL",
    },
  });
  reqA = req.id;
  const tc = await db.testCase.create({
    data: {
      projectId: projectA,
      key: "TC-001",
      title: "Secret test case of A",
      steps: [{ action: "x" }],
      expectedResult: "y",
      type: "POSITIVE",
      priority: "HIGH",
      automatable: true,
      origin: "MANUAL",
      requirements: { create: [{ requirementId: req.id }] },
    },
  });
  tcA = tc.id;
  flowA = (
    await db.userFlow.create({
      data: { projectId: projectA, name: "Flow A", steps: ["a"], origin: "AI" },
    })
  ).id;
  questionA = (
    await db.openQuestion.create({
      data: { projectId: projectA, question: "Question of A?", origin: "AI" },
    })
  ).id;
});

describe("user B cannot see or change project A's Phase 2 data", () => {
  it("reads return 404 for every Phase 2 resource", async () => {
    const p = { projectId: projectA };
    expect((await call(reqsRoute.GET, "/", { session: bob, params: p })).status).toBe(404);
    expect((await call(tcsRoute.GET, "/", { session: bob, params: p })).status).toBe(404);
    expect(
      (await call(tcRoute.GET, "/", { session: bob, params: { ...p, testCaseId: tcA } })).status,
    ).toBe(404);
    expect((await call(exportsRoute.GET, "/", { session: bob, params: p })).status).toBe(404);
    expect((await call(budgetRoute.GET, "/", { session: bob, params: p })).status).toBe(404);
    expect((await call(jobsRoute.GET, "/x?types=EXPORT", { session: bob, params: p })).status).toBe(
      404,
    );
  });

  it("writes return 404 and change nothing, even when IDs are swapped into B's URLs", async () => {
    const asB = { projectId: projectB };
    const attempts = [
      call(reqRoute.PATCH, "/", {
        method: "PATCH",
        session: bob,
        params: { ...asB, requirementId: reqA },
        json: { text: "pwned requirement" },
      }),
      call(reqRoute.DELETE, "/", {
        method: "DELETE",
        session: bob,
        params: { ...asB, requirementId: reqA },
      }),
      call(tcRoute.PATCH, "/", {
        method: "PATCH",
        session: bob,
        params: { ...asB, testCaseId: tcA },
        json: { title: "pwned test case" },
      }),
      call(tcRoute.DELETE, "/", {
        method: "DELETE",
        session: bob,
        params: { ...asB, testCaseId: tcA },
      }),
      call(flowRoute.DELETE, "/", {
        method: "DELETE",
        session: bob,
        params: { ...asB, flowId: flowA },
      }),
      call(questionRoute.PATCH, "/", {
        method: "PATCH",
        session: bob,
        params: { ...asB, questionId: questionA },
        json: { answer: "pwned" },
      }),
      call(reviewRoute.POST, "/", {
        session: bob,
        params: asB,
        json: { testCaseIds: [tcA], decision: "APPROVE" },
      }),
      call(analysisRoute.POST, "/", {
        method: "POST",
        session: bob,
        params: { projectId: projectA },
      }),
      call(generateRoute.POST, "/", {
        session: bob,
        params: asB,
        json: { requirementIds: [reqA] },
      }),
    ];
    for (const res of await Promise.all(attempts)) expect([404, 409]).toContain(res.status);

    expect((await db.requirement.findUniqueOrThrow({ where: { id: reqA } })).text).toBe(
      "Secret requirement of A",
    );
    expect(await db.testCase.findUniqueOrThrow({ where: { id: tcA } })).toMatchObject({
      title: "Secret test case of A",
      status: "DRAFT",
      deletedAt: null,
    });
    expect(
      (await db.openQuestion.findUniqueOrThrow({ where: { id: questionA } })).answer,
    ).toBeNull();
    expect(await db.job.count({ where: { projectId: projectA } })).toBe(0);
  });

  it("a review batch mixing own and foreign IDs is rejected as a whole", async () => {
    const own = await db.testCase.create({
      data: {
        projectId: projectB,
        key: "TC-001",
        title: "B's case",
        steps: [{ action: "x" }],
        expectedResult: "y",
        type: "POSITIVE",
        priority: "LOW",
        automatable: false,
        origin: "MANUAL",
      },
    });
    const res = await call(reviewRoute.POST, "/", {
      session: bob,
      params: { projectId: projectB },
      json: { testCaseIds: [own.id, tcA], decision: "APPROVE" },
    });
    expect(res.status).toBe(404);
    expect((await db.testCase.findUniqueOrThrow({ where: { id: own.id } })).status).toBe("DRAFT");
  });

  it("B cannot download A's export by guessing its id", async () => {
    const exp = await db.export.create({
      data: {
        projectId: projectA,
        kind: "TEST_SCOPE",
        format: "PDF",
        status: "SUCCEEDED",
        storageKey: "k",
        createdById: alice.userId,
      },
    });
    const viaA = await call(exportFileRoute.GET, "/", {
      session: bob,
      params: { projectId: projectA, exportId: exp.id },
    });
    const viaB = await call(exportFileRoute.GET, "/", {
      session: bob,
      params: { projectId: projectB, exportId: exp.id },
    });
    expect(viaA.status).toBe(404);
    expect(viaB.status).toBe(404);
  });
});

describe("role enforcement", () => {
  it("viewers can read and export but not edit, review or run AI", async () => {
    const p = { projectId: projectA };
    expect((await call(reqsRoute.GET, "/", { session: viewer, params: p })).status).toBe(200);
    expect(
      (
        await call(reqsRoute.POST, "/", {
          session: viewer,
          params: p,
          json: { text: "New requirement", type: "FIELD" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(reviewRoute.POST, "/", {
          session: viewer,
          params: p,
          json: { testCaseIds: [tcA], decision: "APPROVE" },
        })
      ).status,
    ).toBe(403);
    expect(
      (await call(analysisRoute.POST, "/", { method: "POST", session: viewer, params: p })).status,
    ).toBe(403);
    expect(
      (await call(generateRoute.POST, "/", { session: viewer, params: p, json: {} })).status,
    ).toBe(403);
    expect(
      (
        await call(questionRoute.PATCH, "/", {
          method: "PATCH",
          session: viewer,
          params: { ...p, questionId: questionA },
          json: { answer: "x" },
        })
      ).status,
    ).toBe(403);
    expect(
      (await call(exportsRoute.POST, "/", { session: viewer, params: p, json: { format: "PDF" } }))
        .status,
    ).toBe(202);
  });

  it("archived projects block AI runs and edits but still allow export", async () => {
    await db.project.update({ where: { id: projectA }, data: { status: "ARCHIVED" } });
    const p = { projectId: projectA };
    expect(
      (await call(analysisRoute.POST, "/", { method: "POST", session: alice, params: p })).status,
    ).toBe(409);
    expect(
      (
        await call(tcRoute.PATCH, "/", {
          method: "PATCH",
          session: alice,
          params: { ...p, testCaseId: tcA },
          json: { title: "Changed title" },
        })
      ).status,
    ).toBe(409);
    expect(
      (await call(exportsRoute.POST, "/", { session: alice, params: p, json: { format: "DOCX" } }))
        .status,
    ).toBe(202);
  });

  it("rejects unknown export formats and malformed review requests", async () => {
    const p = { projectId: projectA };
    expect(
      (await call(exportsRoute.POST, "/", { session: alice, params: p, json: { format: "EXE" } }))
        .status,
    ).toBe(422);
    expect(
      (
        await call(reviewRoute.POST, "/", {
          session: alice,
          params: p,
          json: { testCaseIds: ["' OR 1=1"], decision: "APPROVE" },
        })
      ).status,
    ).toBe(422);
  });
});

describe("Figma import", () => {
  async function addLink(url: string) {
    const res = await call(docsRoute.POST, "/", {
      session: alice,
      params: { projectId: projectA },
      json: { url },
    });
    expect(res.status).toBe(201);
    return (await jsonOf<{ document: { id: string } }>(res)).document.id;
  }

  it("fails clearly when no Figma token is configured", async () => {
    delete process.env.FIGMA_ACCESS_TOKEN;
    resetEnvCache();
    const id = await addLink("https://www.figma.com/design/AbCdEf123456/App");
    expect(await runQueued(projectA, "IMPORT_FIGMA")).toEqual([
      {
        outcome: "failed",
        message: expect.stringMatching(/Figma import isn't set up/) as unknown as string,
      },
    ]);
    expect((await db.document.findUniqueOrThrow({ where: { id } })).extractionStatus).toBe(
      "FAILED",
    );
  });

  it("imports frames as re-encoded PNG documents linked to the Figma link", async () => {
    process.env.FIGMA_ACCESS_TOKEN = "figma-test-token";
    resetEnvCache();
    try {
      const png = await sharp({
        create: { width: 20, height: 20, channels: 3, background: "#2563eb" },
      })
        .png()
        .withExif({ IFD0: { Artist: "SECRET-DESIGNER" } })
        .toBuffer();
      setFigmaFetch((async (url: RequestInfo | URL) => {
        const u = String(url);
        if (u.includes("/nodes?"))
          return Response.json({ nodes: { "1:2": { document: { name: "Checkout" } } } });
        if (u.includes("/images/")) {
          return Response.json({
            err: null,
            images: { "1:2": "https://figma-alpha-api.s3.us-west-2.amazonaws.com/a.png" },
          });
        }
        if (u.startsWith("https://figma-alpha-api.s3")) return new Response(new Uint8Array(png));
        throw new Error(`unexpected ${u}`);
      }) as typeof fetch);
      const linkId = await addLink("https://www.figma.com/design/AbCdEf123456/App?node-id=1-2");
      expect(await runQueued(projectA, "IMPORT_FIGMA")).toEqual([{ outcome: "succeeded" }]);

      const link = await db.document.findUniqueOrThrow({ where: { id: linkId } });
      expect(link).toMatchObject({ extractionStatus: "SUCCEEDED", pageCount: 1 });
      const frame = await db.document.findFirstOrThrow({ where: { derivedFromId: linkId } });
      expect(frame).toMatchObject({
        category: "FIGMA",
        source: "FILE",
        mimeType: "image/png",
        originalName: "Figma - Checkout.png",
      });
    } finally {
      delete process.env.FIGMA_ACCESS_TOKEN;
      resetEnvCache();
    }
  });
});
