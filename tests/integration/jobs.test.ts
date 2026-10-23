import { beforeEach, describe, expect, it } from "vitest";
import * as docRetryRoute from "@/app/api/projects/[projectId]/documents/[documentId]/retry/route";
import * as docsRoute from "@/app/api/projects/[projectId]/documents/route";
import * as jobRoute from "@/app/api/projects/[projectId]/jobs/[jobId]/route";
import { db } from "@/server/db";
import { getDispatcher, type RecordingDispatcher } from "@/server/jobs/dispatcher";
import { QUEUE_UNAVAILABLE_MESSAGE } from "@/server/jobs/enqueue";
import { JOB_HANDLERS } from "@/server/jobs/handlers";
import { LOST_MESSAGE, MAX_QUEUED_MS, reapStuckJobs } from "@/server/jobs/reaper";
import { JobFailure, TIMEOUT_MESSAGE, runTrackedJob, type JobHandler } from "@/server/jobs/runner";
import { createLogger } from "@/server/logger";
import {
  call,
  createProject,
  fileForm,
  jsonOf,
  userWithSession,
  type Session,
} from "../support/api";
import { makeDocx, makeTextPdf } from "../support/fixtures";

const log = createLogger({ level: "silent" });
let tester: Session;
let projectId: string;

beforeEach(async () => {
  const t = await userWithSession("QA_TESTER");
  tester = t.session;
  projectId = (await createProject("Jobs", [t.user.id])).id;
});

async function uploadAndGetJob(name: string, data: Buffer | string) {
  const res = await call(docsRoute.POST, "/", {
    session: tester,
    params: { projectId },
    form: fileForm("REQUIREMENTS", name, data),
  });
  expect(res.status).toBe(201);
  const { document } = await jsonOf<{ document: { id: string } }>(res);
  const job = await db.job.findFirstOrThrow({
    where: { projectId },
    orderBy: { createdAt: "desc" },
  });
  return { documentId: document.id, jobId: job.id };
}

const run = (jobId: string, attempt = 1, handlers = JOB_HANDLERS, timeoutMs = 20_000) =>
  runTrackedJob({ jobId, attempt, handlers, timeoutMs, log });

describe("text extraction job (real handler, in-memory storage)", () => {
  it("extracts PDF text end to end and marks everything succeeded", async () => {
    const { documentId, jobId } = await uploadAndGetJob(
      "frd.pdf",
      makeTextPdf(["REQ-7 The cart total must include VAT for every line item shown."]),
    );
    expect(await run(jobId)).toEqual({ outcome: "succeeded" });

    const doc = await db.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(doc.extractionStatus).toBe("SUCCEEDED");
    expect(doc.extractedText).toContain("cart total must include VAT");
    expect(doc.pageCount).toBe(1);

    const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(job).toMatchObject({ status: "SUCCEEDED", progress: 100, attempts: 1 });
    expect(job.finishedAt).not.toBeNull();

    const res = await call(jobRoute.GET, "/", { session: tester, params: { projectId, jobId } });
    expect((await jsonOf<{ job: { status: string } }>(res)).job.status).toBe("SUCCEEDED");
  });

  it("extracts DOCX and CSV", async () => {
    const a = await uploadAndGetJob("stories.docx", makeDocx(["As a shopper I can save my cart"]));
    await run(a.jobId);
    expect(
      (await db.document.findUniqueOrThrow({ where: { id: a.documentId } })).extractedText,
    ).toContain("save my cart");
    const b = await uploadAndGetJob("cases.csv", "id,title\n1,Login works");
    await run(b.jobId);
    expect(
      (await db.document.findUniqueOrThrow({ where: { id: b.documentId } })).extractedText,
    ).toContain("title: Login works");
  });

  it("is idempotent: a finished job is not re-run", async () => {
    const { jobId } = await uploadAndGetJob("a.txt", "hello world");
    await run(jobId);
    expect(await run(jobId, 2)).toEqual({ outcome: "skipped" });
  });

  it("fails without retrying when the file itself is unreadable, keeping the upload", async () => {
    const { documentId, jobId } = await uploadAndGetJob("blank.txt", "   \n\n  ");
    const out = await run(jobId);
    expect(out.outcome).toBe("failed");
    const doc = await db.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(doc.extractionStatus).toBe("FAILED");
    expect(doc.extractionError).toMatch(/readable text/);
    expect(doc.deletedAt).toBeNull();
  });
});

describe("retries, timeouts and final failure", () => {
  it("retries transient errors, then fails with a friendly message after max attempts", async () => {
    const { documentId, jobId } = await uploadAndGetJob("a.txt", "x");
    let calls = 0;
    const flaky: JobHandler = async () => {
      calls++;
      throw new Error("ECONNRESET internal detail");
    };
    const handlers = { EXTRACT_TEXT: flaky };

    expect((await run(jobId, 1, handlers)).outcome).toBe("retry");
    expect((await db.job.findUniqueOrThrow({ where: { id: jobId } })).status).toBe("QUEUED");
    expect((await run(jobId, 2, handlers)).outcome).toBe("retry");
    const final = await run(jobId, 3, handlers);
    expect(final.outcome).toBe("failed");
    expect(calls).toBe(3);

    const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe("FAILED");
    expect(job.error).not.toContain("ECONNRESET"); // internal details never reach the user
    const doc = await db.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(doc.extractionStatus).toBe("FAILED");
  });

  it("does not retry non-retryable failures", async () => {
    const { jobId } = await uploadAndGetJob("a.txt", "x");
    const bad: JobHandler = async () => {
      throw new JobFailure("This file is broken.", false);
    };
    const out = await run(jobId, 1, { EXTRACT_TEXT: bad });
    expect(out).toEqual({ outcome: "failed", message: "This file is broken." });
  });

  it("stops a hanging job at its timeout instead of waiting forever", async () => {
    const { jobId } = await uploadAndGetJob("a.txt", "x");
    let aborted = false;
    const hang: JobHandler = ({ signal }) =>
      new Promise(() => {
        signal.addEventListener("abort", () => {
          aborted = true;
        });
      });
    const started = Date.now();
    const out = await run(jobId, 3, { EXTRACT_TEXT: hang }, 200);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(out).toEqual({ outcome: "failed", message: TIMEOUT_MESSAGE });
    expect(aborted).toBe(true);
  });

  it("the reaper fails jobs left RUNNING by a crashed worker, and lost QUEUED jobs", async () => {
    const a = await uploadAndGetJob("a.txt", "x");
    const b = await uploadAndGetJob("b.txt", "y");
    await db.job.update({
      where: { id: a.jobId },
      data: { status: "RUNNING", timeoutAt: new Date(Date.now() - 1000) },
    });
    await db.job.update({
      where: { id: b.jobId },
      data: { createdAt: new Date(Date.now() - MAX_QUEUED_MS - 1000) },
    });

    expect(await reapStuckJobs(log)).toBe(2);
    const [ja, jb] = await Promise.all([
      db.job.findUniqueOrThrow({ where: { id: a.jobId } }),
      db.job.findUniqueOrThrow({ where: { id: b.jobId } }),
    ]);
    expect(ja).toMatchObject({ status: "FAILED", error: TIMEOUT_MESSAGE });
    expect(jb).toMatchObject({ status: "FAILED", error: LOST_MESSAGE });
    expect(
      (await db.document.findUniqueOrThrow({ where: { id: a.documentId } })).extractionStatus,
    ).toBe("FAILED");
    expect(await reapStuckJobs(log)).toBe(0);
  });

  it("if the queue is down, the upload is still saved and the job shows a final failed state", async () => {
    (getDispatcher() as RecordingDispatcher).fail = true;
    const res = await call(docsRoute.POST, "/", {
      session: tester,
      params: { projectId },
      form: fileForm("REQUIREMENTS", "a.txt", "keep me"),
    });
    expect(res.status).toBe(201);
    const doc = await db.document.findFirstOrThrow({ where: { projectId } });
    expect(doc.storageKey).not.toBeNull();
    expect(doc.extractionStatus).toBe("FAILED");
    expect(doc.extractionError).toBe(QUEUE_UNAVAILABLE_MESSAGE);
    const job = await db.job.findFirstOrThrow({ where: { projectId } });
    expect(job.status).toBe("FAILED");

    // Once the queue is back, "Try again" re-queues it.
    (getDispatcher() as RecordingDispatcher).fail = false;
    const retry = await call(docRetryRoute.POST, "/", {
      method: "POST",
      session: tester,
      params: { projectId, documentId: doc.id },
    });
    expect(retry.status).toBe(200);
    expect(
      (await jsonOf<{ document: { extractionStatus: string } }>(retry)).document.extractionStatus,
    ).toBe("PENDING");
    expect((getDispatcher() as RecordingDispatcher).dispatched).toHaveLength(1);
  });

  it("retry is refused unless extraction actually failed", async () => {
    const { documentId } = await uploadAndGetJob("a.txt", "x");
    const res = await call(docRetryRoute.POST, "/", {
      method: "POST",
      session: tester,
      params: { projectId, documentId },
    });
    expect(res.status).toBe(409);
  });
});
