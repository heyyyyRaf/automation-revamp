import { db } from "@/server/db";
import { json, route } from "@/server/http/handler";

/** Readiness: the app can reach its database. Reveals no version or config details. */
export const GET = route({ auth: false }, async ({ log }) => {
  try {
    await db.$queryRaw`SELECT 1`;
    return json({ status: "ok" });
  } catch (err) {
    log.error({ err }, "health check failed");
    return json({ status: "unavailable" }, 503);
  }
});
