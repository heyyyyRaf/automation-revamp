/**
 * Egress proxy service (docker compose: `egress`).
 * - :3128 proxy, reachable only from the internal sandbox network
 * - :3129 control API, reachable only from the backend network (worker)
 */
import http from "node:http";
import { z } from "zod";
import { checkControlToken, createEgressProxy, GrantStore } from "@/server/egress/proxy";
import { normalizeOrigin } from "@/server/net/url-guard";
import { logger } from "@/server/logger";

const log = logger.child({ service: "egress" });
const controlToken = process.env.EGRESS_CONTROL_TOKEN ?? "";
if (controlToken.length < 16) {
  log.fatal("EGRESS_CONTROL_TOKEN must be set (min 16 chars)");
  process.exit(1);
}

const grants = new GrantStore();
createEgressProxy({ grants, log }).listen(3128, "0.0.0.0", () => log.info("egress proxy on :3128"));

const grantSchema = z.object({
  token: z.string().min(32).max(128),
  label: z.string().max(100),
  origins: z
    .array(z.object({ origin: z.string().max(300), allowPrivate: z.boolean() }))
    .min(1)
    .max(20),
  ttlSeconds: z.number().int().min(10).max(14_400),
});

http
  .createServer((req, res) => {
    if (!checkControlToken(req.headers.authorization, controlToken)) {
      res.writeHead(401).end();
      return;
    }
    if (req.method === "DELETE" && req.url?.startsWith("/grants/")) {
      grants.remove(decodeURIComponent(req.url.slice("/grants/".length)));
      res.writeHead(204).end();
      return;
    }
    if (req.method !== "POST" || req.url !== "/grants") {
      res.writeHead(404).end();
      return;
    }
    let body = "";
    req.on("data", (c: Buffer) => {
      body += c.toString("utf8");
      if (body.length > 64_000) req.destroy();
    });
    req.on("end", () => {
      try {
        const g = grantSchema.parse(JSON.parse(body));
        const origins = g.origins.map((o) => {
          const origin = normalizeOrigin(o.origin);
          if (!origin) throw new Error("bad origin");
          return { origin, allowPrivate: o.allowPrivate };
        });
        grants.add(g.token, g.label, origins, g.ttlSeconds);
        res.writeHead(204).end();
      } catch {
        res.writeHead(400).end();
      }
    });
  })
  .listen(3129, "0.0.0.0", () => log.info("egress control on :3129"));
