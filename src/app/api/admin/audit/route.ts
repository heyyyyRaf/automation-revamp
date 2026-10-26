import { json, route } from "@/server/http/handler";
import { listAuditLog } from "@/server/services/audit-log";

export const GET = route(async ({ auth, req }) => {
  const p = req.nextUrl.searchParams;
  const get = (k: string) => p.get(k) ?? undefined;
  return json(
    await listAuditLog(auth, {
      projectId: get("projectId"),
      actorId: get("actorId"),
      action: get("action"),
      cursor: get("cursor"),
    }),
  );
});
