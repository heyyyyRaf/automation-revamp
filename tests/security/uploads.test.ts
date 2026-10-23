import { beforeEach, describe, expect, it } from "vitest";
import * as docFileRoute from "@/app/api/projects/[projectId]/documents/[documentId]/file/route";
import * as docsRoute from "@/app/api/projects/[projectId]/documents/route";
import { db } from "@/server/db";
import { getDispatcher, type RecordingDispatcher } from "@/server/jobs/dispatcher";
import { getStorage, type MemoryStorage } from "@/server/storage/storage";
import {
  call,
  createProject,
  fileForm,
  jsonOf,
  userWithSession,
  type Session,
} from "../support/api";
import { fakeExe, makeDocx, makeJpegWithExif, makeTextPdf } from "../support/fixtures";

let tester: Session;
let projectId: string;

beforeEach(async () => {
  const t = await userWithSession("QA_TESTER");
  tester = t.session;
  projectId = (await createProject("Uploads", [t.user.id])).id;
});

const upload = (category: string, name: string, data: Buffer | string) =>
  call(docsRoute.POST, "/", {
    session: tester,
    params: { projectId },
    form: fileForm(category, name, data),
  });

describe("upload endpoint", () => {
  it("stores a valid file under a random key and queues text extraction", async () => {
    const res = await upload(
      "REQUIREMENTS",
      "Login FRD.pdf",
      makeTextPdf(["Users log in with email."]),
    );
    expect(res.status).toBe(201);
    const { document } = await jsonOf<{
      document: { id: string; extractionStatus: string; originalName: string };
    }>(res);
    expect(document.extractionStatus).toBe("PENDING");
    expect(document.originalName).toBe("Login FRD.pdf");
    expect(document).not.toHaveProperty("storageKey");

    const row = await db.document.findUniqueOrThrow({ where: { id: document.id } });
    expect(row.storageKey).toMatch(new RegExp(`^projects/${projectId}/documents/[0-9a-f-]{36}$`));
    expect(row.storageKey).not.toContain("Login");
    expect(row.sha256).toHaveLength(64);
    expect((getStorage() as MemoryStorage).objects.has(row.storageKey!)).toBe(true);

    const dispatched = (getDispatcher() as RecordingDispatcher).dispatched;
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({
      type: "EXTRACT_TEXT",
      payload: { documentId: document.id },
    });
  });

  it("accepts DOCX, and images without queuing extraction", async () => {
    expect((await upload("REQUIREMENTS", "stories.docx", makeDocx(["As a user…"]))).status).toBe(
      201,
    );
    const img = await upload("FIGMA", "frame.jpg", await makeJpegWithExif("owner"));
    expect(img.status).toBe(201);
    expect(
      (await jsonOf<{ document: { extractionStatus: string } }>(img)).document.extractionStatus,
    ).toBe("NOT_APPLICABLE");
  });

  it("rejects a spoofed executable with 415 and stores nothing", async () => {
    const res = await upload("REQUIREMENTS", "requirements.pdf", fakeExe());
    expect(res.status).toBe(415);
    expect(await db.document.count()).toBe(0);
    expect((getStorage() as MemoryStorage).objects.size).toBe(0);
  });

  it("rejects files over the size limit with 413", async () => {
    const res = await upload("REQUIREMENTS", "big.txt", Buffer.alloc(26 * 1024 * 1024, 0x61));
    expect(res.status).toBe(413);
    expect(await db.document.count()).toBe(0);
  });

  it("rejects wrong category, missing file and unknown category", async () => {
    expect((await upload("FIGMA", "spec.txt", "text")).status).toBe(415);
    expect((await upload("NUCLEAR", "spec.txt", "text")).status).toBe(400);
    const form = new FormData();
    form.set("category", "REQUIREMENTS");
    expect(
      (await call(docsRoute.POST, "/", { session: tester, params: { projectId }, form })).status,
    ).toBe(400);
  });

  it("accepts only https figma.com links", async () => {
    const add = (url: string) =>
      call(docsRoute.POST, "/", { session: tester, params: { projectId }, json: { url } });
    expect((await add("https://www.figma.com/design/abc/App")).status).toBe(201);
    expect((await add("javascript:alert(document.cookie)")).status).toBe(422);
    expect((await add("https://figma.com.attacker.io/x")).status).toBe(422);
  });

  it("serves downloads as attachments that the browser will not execute", async () => {
    const res = await upload("REQUIREMENTS", "a.md", "# <script>alert(1)</script>");
    const { document } = await jsonOf<{ document: { id: string } }>(res);
    const dl = await call(docFileRoute.GET, "/", {
      session: tester,
      params: { projectId, documentId: document.id },
    });
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(dl.headers.get("x-content-type-options")).toBe("nosniff");
    expect(dl.headers.get("content-security-policy")).toContain("sandbox");
    expect(dl.headers.get("content-type")).toBe("text/markdown");
  });
});
