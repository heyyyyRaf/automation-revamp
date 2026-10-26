import { createProjectSchema } from "@/lib/validation";
import { json, readJson, route } from "@/server/http/handler";
import { createProject, dashboardStats, listProjects } from "@/server/services/projects";

export const GET = route(async ({ auth, req }) => {
  const includeArchived = req.nextUrl.searchParams.get("archived") === "1";
  const projects = await listProjects(auth, { includeArchived });
  return json({ projects, stats: await dashboardStats(auth, projects) });
});

export const POST = route(async ({ auth, req, ip, requestId }) => {
  const input = await readJson(req, createProjectSchema);
  return json({ project: await createProject(auth, input, { ip, requestId }) }, 201);
});
