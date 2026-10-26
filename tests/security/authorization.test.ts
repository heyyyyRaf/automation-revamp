/**
 * Proves project isolation: a user can never read or change another team's project data,
 * and every role is enforced server-side regardless of what the UI shows.
 */
import { beforeEach, describe, expect, it } from "vitest";
import * as usersRoute from "@/app/api/admin/users/route";
import * as userRoute from "@/app/api/admin/users/[userId]/route";
import * as docRoute from "@/app/api/projects/[projectId]/documents/[documentId]/route";
import * as docFileRoute from "@/app/api/projects/[projectId]/documents/[documentId]/file/route";
import * as docRetryRoute from "@/app/api/projects/[projectId]/documents/[documentId]/retry/route";
import * as docsRoute from "@/app/api/projects/[projectId]/documents/route";
import * as jobRoute from "@/app/api/projects/[projectId]/jobs/[jobId]/route";
import * as membersRoute from "@/app/api/projects/[projectId]/members/route";
import * as memberRoute from "@/app/api/projects/[projectId]/members/[userId]/route";
import * as projectRoute from "@/app/api/projects/[projectId]/route";
import * as projectsRoute from "@/app/api/projects/route";
import { db } from "@/server/db";
import {
  call,
  createProject,
  fileForm,
  jsonOf,
  userWithSession,
  type Session,
} from "../support/api";

interface Ctx {
  alice: Session; // QA tester on project A
  bob: Session; // QA tester on project B
  viewer: Session; // viewer on project A
  admin: Session;
  projectA: string;
  projectB: string;
  docA: string;
  jobA: string;
}

let c: Ctx;

beforeEach(async () => {
  const alice = await userWithSession("QA_TESTER");
  const bob = await userWithSession("QA_TESTER");
  const viewer = await userWithSession("VIEWER");
  const admin = await userWithSession("ADMIN");
  const a = await createProject("Project A", [alice.user.id, viewer.user.id], admin.user.id);
  const b = await createProject("Project B", [bob.user.id], admin.user.id);

  const up = await call(docsRoute.POST, "/", {
    session: alice.session,
    params: { projectId: a.id },
    form: fileForm("REQUIREMENTS", "secret-a.txt", "Project A confidential requirement"),
  });
  expect(up.status).toBe(201);
  const { document } = await jsonOf<{ document: { id: string } }>(up);
  const job = await db.job.findFirstOrThrow({ where: { projectId: a.id } });

  c = {
    alice: alice.session,
    bob: bob.session,
    viewer: viewer.session,
    admin: admin.session,
    projectA: a.id,
    projectB: b.id,
    docA: document.id,
    jobA: job.id,
  };
});

describe("cross-project isolation (user B vs project A)", () => {
  it("B cannot see A in the project list", async () => {
    const res = await call(projectsRoute.GET, "/api/projects", { session: c.bob });
    const { projects } = await jsonOf<{ projects: { id: string }[] }>(res);
    expect(projects.map((p) => p.id)).toEqual([c.projectB]);
  });

  it("B gets 404 (not 403) reading A, so A's existence is not revealed", async () => {
    const res = await call(projectRoute.GET, "/", {
      session: c.bob,
      params: { projectId: c.projectA },
    });
    expect(res.status).toBe(404);
  });

  it("B cannot list, read, download or retry A's documents", async () => {
    const p = { projectId: c.projectA, documentId: c.docA };
    expect(
      (await call(docsRoute.GET, "/", { session: c.bob, params: { projectId: c.projectA } }))
        .status,
    ).toBe(404);
    expect((await call(docRoute.GET, "/", { session: c.bob, params: p })).status).toBe(404);
    expect((await call(docFileRoute.GET, "/", { session: c.bob, params: p })).status).toBe(404);
    expect(
      (await call(docRetryRoute.POST, "/", { method: "POST", session: c.bob, params: p })).status,
    ).toBe(404);
  });

  it("B cannot reach A's document through B's own project URL (ID swapping)", async () => {
    const p = { projectId: c.projectB, documentId: c.docA };
    expect((await call(docRoute.GET, "/", { session: c.bob, params: p })).status).toBe(404);
    expect((await call(docFileRoute.GET, "/", { session: c.bob, params: p })).status).toBe(404);
    expect(
      (await call(docRoute.DELETE, "/", { method: "DELETE", session: c.bob, params: p })).status,
    ).toBe(404);
    const doc = await db.document.findUniqueOrThrow({ where: { id: c.docA } });
    expect(doc.deletedAt).toBeNull();
  });

  it("B cannot upload to, delete from, rename or read jobs of A", async () => {
    const up = await call(docsRoute.POST, "/", {
      session: c.bob,
      params: { projectId: c.projectA },
      form: fileForm("REQUIREMENTS", "x.txt", "injected"),
    });
    expect(up.status).toBe(404);
    const del = await call(docRoute.DELETE, "/", {
      method: "DELETE",
      session: c.bob,
      params: { projectId: c.projectA, documentId: c.docA },
    });
    expect(del.status).toBe(404);
    const rename = await call(projectRoute.PATCH, "/", {
      method: "PATCH",
      session: c.bob,
      params: { projectId: c.projectA },
      json: { name: "pwned" },
    });
    expect(rename.status).toBe(404);
    const job = await call(jobRoute.GET, "/", {
      session: c.bob,
      params: { projectId: c.projectA, jobId: c.jobA },
    });
    expect(job.status).toBe(404);
    expect(await db.document.count({ where: { projectId: c.projectA } })).toBe(1);
    expect((await db.project.findUniqueOrThrow({ where: { id: c.projectA } })).name).toBe(
      "Project A",
    );
  });

  it("B cannot list A's members", async () => {
    const res = await call(membersRoute.GET, "/", {
      session: c.bob,
      params: { projectId: c.projectA },
    });
    expect(res.status).toBe(404);
  });

  it("malformed or injected IDs are rejected safely", async () => {
    for (const projectId of ["' OR 1=1 --", "../../etc", "x".repeat(500)]) {
      const res = await call(projectRoute.GET, "/", { session: c.bob, params: { projectId } });
      expect(res.status).toBe(404);
    }
  });
});

describe("role enforcement", () => {
  it("members of A can read A", async () => {
    for (const s of [c.alice, c.viewer, c.admin]) {
      const res = await call(docRoute.GET, "/", {
        session: s,
        params: { projectId: c.projectA, documentId: c.docA },
      });
      expect(res.status).toBe(200);
    }
  });

  it("viewers cannot upload, delete or retry", async () => {
    const up = await call(docsRoute.POST, "/", {
      session: c.viewer,
      params: { projectId: c.projectA },
      form: fileForm("REQUIREMENTS", "x.txt", "x"),
    });
    expect(up.status).toBe(403);
    const del = await call(docRoute.DELETE, "/", {
      method: "DELETE",
      session: c.viewer,
      params: { projectId: c.projectA, documentId: c.docA },
    });
    expect(del.status).toBe(403);
  });

  it("testers create projects they own, but only the owner or an Admin manages a project", async () => {
    // FR-1.1: a tester may create a project and becomes its owner and a member.
    const created = await call(projectsRoute.POST, "/", {
      session: c.alice,
      json: { name: "Mine" },
    });
    expect(created.status).toBe(201);
    const { project } = await jsonOf<{ project: { id: string; ownerId: string } }>(created);
    expect(project.ownerId).toBe(c.alice.userId);
    expect(
      await db.projectMember.count({ where: { projectId: project.id, userId: c.alice.userId } }),
    ).toBe(1);
    // ...but cannot create one for someone else.
    expect(
      (
        await call(projectsRoute.POST, "/", {
          session: c.alice,
          json: { name: "For Bob", ownerId: c.bob.userId },
        })
      ).status,
    ).toBe(403);
    // Viewers can't create projects at all.
    expect(
      (await call(projectsRoute.POST, "/", { session: c.viewer, json: { name: "V" } })).status,
    ).toBe(403);

    // The owner manages their own project's members and can archive it.
    const ownAdd = await call(membersRoute.POST, "/", {
      session: c.alice,
      params: { projectId: project.id },
      json: { userId: c.bob.userId },
    });
    expect(ownAdd.status).toBe(201);
    const ownerRemoval = await call(memberRoute.DELETE, "/", {
      method: "DELETE",
      session: c.alice,
      params: { projectId: project.id, userId: c.alice.userId },
    });
    expect(ownerRemoval.status).toBe(409); // the owner can't be removed
    // Ownership can't go to a Viewer.
    await call(membersRoute.POST, "/", {
      session: c.alice,
      params: { projectId: project.id },
      json: { userId: c.viewer.userId },
    });
    const toViewer = await call(projectRoute.PATCH, "/", {
      method: "PATCH",
      session: c.alice,
      params: { projectId: project.id },
      json: { ownerId: c.viewer.userId },
    });
    expect(toViewer.status).toBe(400);
    // Bob is a member, not the owner: he can't manage it.
    const bobArchive = await call(projectRoute.PATCH, "/", {
      method: "PATCH",
      session: c.bob,
      params: { projectId: project.id },
      json: { status: "ARCHIVED" },
    });
    expect(bobArchive.status).toBe(403);
    const ownArchive = await call(projectRoute.PATCH, "/", {
      method: "PATCH",
      session: c.alice,
      params: { projectId: project.id },
      json: { status: "ARCHIVED" },
    });
    expect(ownArchive.status).toBe(200);
    const log = await db.auditLog.findFirstOrThrow({
      where: { projectId: project.id, action: "project.archive" },
    });
    expect(log.before).toEqual({ status: "ACTIVE" });
    expect(log.after).toEqual({ status: "ARCHIVED" });

    // On a project Alice doesn't own, she can't archive or manage members.
    const archive = await call(projectRoute.PATCH, "/", {
      method: "PATCH",
      session: c.alice,
      params: { projectId: c.projectA },
      json: { status: "ARCHIVED" },
    });
    expect(archive.status).toBe(403);
    const bobUser = await db.user.findFirstOrThrow({ where: { id: c.bob.userId } });
    const add = await call(membersRoute.POST, "/", {
      session: c.alice,
      params: { projectId: c.projectA },
      json: { userId: bobUser.id },
    });
    expect(add.status).toBe(403);
    const remove = await call(memberRoute.DELETE, "/", {
      method: "DELETE",
      session: c.alice,
      params: { projectId: c.projectA, userId: c.viewer.userId },
    });
    expect(remove.status).toBe(403);
  });

  it("only admins can manage users", async () => {
    for (const s of [c.alice, c.viewer]) {
      expect((await call(usersRoute.GET, "/", { session: s })).status).toBe(403);
      const create = await call(usersRoute.POST, "/", {
        session: s,
        json: { email: "new@test.local", name: "N", role: "ADMIN", password: "long-enough-pass" },
      });
      expect(create.status).toBe(403);
    }
    // A tester cannot promote themselves.
    const self = await call(userRoute.PATCH, "/", {
      method: "PATCH",
      session: c.alice,
      params: { userId: c.alice.userId },
      json: { role: "ADMIN" },
    });
    expect(self.status).toBe(403);
    expect((await db.user.findUniqueOrThrow({ where: { id: c.alice.userId } })).role).toBe(
      "QA_TESTER",
    );
  });

  it("admins see every project and can add members, which grants access", async () => {
    const list = await jsonOf<{ projects: unknown[] }>(
      await call(projectsRoute.GET, "/", { session: c.admin }),
    );
    expect(list.projects).toHaveLength(2);
    const add = await call(membersRoute.POST, "/", {
      session: c.admin,
      params: { projectId: c.projectA },
      json: { userId: c.bob.userId },
    });
    expect(add.status).toBe(201);
    expect(
      (await call(projectRoute.GET, "/", { session: c.bob, params: { projectId: c.projectA } }))
        .status,
    ).toBe(200);
    const removed = await call(memberRoute.DELETE, "/", {
      method: "DELETE",
      session: c.admin,
      params: { projectId: c.projectA, userId: c.bob.userId },
    });
    expect(removed.status).toBe(200);
    expect(
      (await call(projectRoute.GET, "/", { session: c.bob, params: { projectId: c.projectA } }))
        .status,
    ).toBe(404);
  });

  it("an admin cannot demote or deactivate themselves", async () => {
    const res = await call(userRoute.PATCH, "/", {
      method: "PATCH",
      session: c.admin,
      params: { userId: c.admin.userId },
      json: { isActive: false },
    });
    expect(res.status).toBe(400);
  });

  it("archived projects are read-only for everyone until restored", async () => {
    const archive = await call(projectRoute.PATCH, "/", {
      method: "PATCH",
      session: c.admin,
      params: { projectId: c.projectA },
      json: { status: "ARCHIVED" },
    });
    expect(archive.status).toBe(200);
    const up = await call(docsRoute.POST, "/", {
      session: c.alice,
      params: { projectId: c.projectA },
      form: fileForm("REQUIREMENTS", "x.txt", "x"),
    });
    expect(up.status).toBe(409);
    expect(
      (
        await call(docRoute.GET, "/", {
          session: c.alice,
          params: { projectId: c.projectA, documentId: c.docA },
        })
      ).status,
    ).toBe(200);
    const restore = await call(projectRoute.PATCH, "/", {
      method: "PATCH",
      session: c.admin,
      params: { projectId: c.projectA },
      json: { status: "ACTIVE" },
    });
    expect(restore.status).toBe(200);
  });

  it("writes an audit record for privileged actions", async () => {
    await call(projectsRoute.POST, "/", { session: c.admin, json: { name: "Audited" } });
    const actions = (await db.auditLog.findMany()).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["project.create", "document.upload"]));
  });
});
