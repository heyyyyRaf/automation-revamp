import http from "node:http";
import net from "node:net";
import { timingSafeEqual } from "node:crypto";
import type { Logger } from "@/server/logger";
import { resolveAllowed, systemResolver, type Resolver } from "@/server/net/url-guard";

/**
 * Egress proxy: the only way out of a runner sandbox.
 *
 * Each run gets a random token (sent by Chromium as proxy credentials) mapped to the exact
 * origins an Admin approved. Every connection is checked: origin granted for this token,
 * then DNS-resolved and the resolved IP checked (no metadata / link-local; private only if
 * approved), then connected to that exact IP — so DNS rebinding cannot redirect the request.
 */

export interface GrantedOrigin {
  origin: string;
  allowPrivate: boolean;
}

interface Grant {
  label: string;
  origins: Map<string, GrantedOrigin>;
  expiresAt: number;
}

export class GrantStore {
  private readonly grants = new Map<string, Grant>();

  add(token: string, label: string, origins: GrantedOrigin[], ttlSeconds: number): void {
    this.grants.set(token, {
      label,
      origins: new Map(origins.map((o) => [o.origin, o])),
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  remove(token: string): void {
    this.grants.delete(token);
  }

  lookup(token: string): Grant | null {
    const g = this.grants.get(token);
    if (!g) return null;
    if (g.expiresAt < Date.now()) {
      this.grants.delete(token);
      return null;
    }
    return g;
  }
}

function tokenFrom(header: string | undefined): string | null {
  if (!header?.startsWith("Basic ")) return null;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const i = decoded.indexOf(":");
  return i >= 0 ? decoded.slice(i + 1) : null;
}

/** Origins as the browser would form them; default ports are omitted. */
function originFor(scheme: "http" | "https", host: string, port: number): string {
  const def = scheme === "https" ? 443 : 80;
  const h = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `${scheme}://${h.toLowerCase()}${port === def ? "" : `:${port}`}`;
}

export interface EgressProxyOptions {
  grants: GrantStore;
  log: Logger;
  resolver?: Resolver;
}

export function createEgressProxy({
  grants,
  log,
  resolver = systemResolver,
}: EgressProxyOptions): http.Server {
  async function authorize(
    proxyAuth: string | undefined,
    origins: string[],
    host: string,
  ): Promise<
    { ok: true; address: string; label: string } | { ok: false; status: number; reason: string }
  > {
    const token = tokenFrom(proxyAuth);
    const grant = token ? grants.lookup(token) : null;
    if (!grant) return { ok: false, status: 407, reason: "missing or expired run credentials" };
    const granted = origins.map((o) => grant.origins.get(o)).find(Boolean);
    if (!granted) return { ok: false, status: 403, reason: `origin not approved: ${origins[0]}` };
    const resolved = await resolveAllowed(host, granted.allowPrivate, resolver);
    if (!resolved.ok) return { ok: false, status: 403, reason: resolved.reason };
    return { ok: true, address: resolved.address, label: grant.label };
  }

  const server = http.createServer((req, res) => {
    // Plain-HTTP proxying: absolute-form request URI.
    void (async () => {
      let target: URL;
      try {
        target = new URL(req.url ?? "");
      } catch {
        res.writeHead(400).end("Bad request");
        return;
      }
      if (target.protocol !== "http:") {
        res.writeHead(400).end("Only http:// is proxied directly; use CONNECT for https.");
        return;
      }
      const port = Number(target.port || 80);
      const auth = await authorize(
        req.headers["proxy-authorization"],
        [originFor("http", target.hostname, port)],
        target.hostname,
      );
      if (!auth.ok) {
        log.warn({ status: auth.status, reason: auth.reason }, "egress denied");
        res.writeHead(
          auth.status,
          auth.status === 407 ? { "proxy-authenticate": 'Basic realm="traxion"' } : {},
        );
        res.end(
          auth.status === 407
            ? "Proxy authentication required"
            : "Blocked by Traxion egress policy",
        );
        return;
      }
      const headers = { ...req.headers };
      delete headers["proxy-authorization"];
      delete headers["proxy-connection"];
      const upstream = http.request(
        {
          host: auth.address,
          port,
          method: req.method,
          path: `${target.pathname}${target.search}`,
          headers: { ...headers, host: target.host },
          timeout: 60_000,
        },
        (up) => {
          res.writeHead(up.statusCode ?? 502, up.headers);
          up.pipe(res);
        },
      );
      upstream.on("error", () => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      upstream.on("timeout", () => upstream.destroy());
      req.pipe(upstream);
    })();
  });

  server.on("connect", (req: http.IncomingMessage, client: net.Socket, head: Buffer) => {
    void (async () => {
      const m = /^\[?([^\]]+?)\]?:(\d{1,5})$/.exec(req.url ?? "");
      const host = m?.[1];
      const port = Number(m?.[2]);
      if (!host || !port || port > 65535) {
        client.end("HTTP/1.1 400 Bad Request\r\n\r\n");
        return;
      }
      const auth = await authorize(
        req.headers["proxy-authorization"],
        [originFor("https", host, port), originFor("http", host, port)],
        host,
      );
      if (!auth.ok) {
        log.warn({ status: auth.status, reason: auth.reason }, "egress denied");
        client.end(
          auth.status === 407
            ? 'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="traxion"\r\n\r\n'
            : "HTTP/1.1 403 Forbidden\r\n\r\n",
        );
        return;
      }
      const upstream = net.connect(port, auth.address, () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstream.write(head);
        upstream.pipe(client);
        client.pipe(upstream);
      });
      upstream.setTimeout(120_000, () => upstream.destroy());
      upstream.on("error", () => client.destroy());
      client.on("error", () => upstream.destroy());
    })();
  });

  server.on("clientError", (_err, socket) => socket.destroy());
  return server;
}

/** Bearer-token check for the control API. */
export function checkControlToken(header: string | undefined, expected: string): boolean {
  const got = Buffer.from(header?.startsWith("Bearer ") ? header.slice(7) : "");
  const want = Buffer.from(expected);
  return got.length === want.length && timingSafeEqual(got, want);
}
