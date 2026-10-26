import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createEgressProxy, GrantStore, type GrantedOrigin } from "@/server/egress/proxy";
import { getEnv } from "@/server/env";
import { logger } from "@/server/logger";

export interface EgressGrant {
  proxy: { server: string; username: string; password: string };
  revoke(): Promise<void>;
}

export interface Egress {
  grant(label: string, origins: GrantedOrigin[], ttlSeconds: number): Promise<EgressGrant>;
}

const newToken = () => randomBytes(32).toString("base64url");

/** Production: the egress proxy service, configured through its control API. */
class RemoteEgress implements Egress {
  constructor(
    private readonly controlUrl: string,
    private readonly controlToken: string,
    private readonly proxyUrl: string,
  ) {}

  async grant(label: string, origins: GrantedOrigin[], ttlSeconds: number): Promise<EgressGrant> {
    const token = newToken();
    const res = await fetch(`${this.controlUrl}/grants`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.controlToken}`, "content-type": "application/json" },
      body: JSON.stringify({ token, label, origins, ttlSeconds }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`egress grant failed: ${res.status}`);
    return {
      proxy: { server: this.proxyUrl, username: "run", password: token },
      revoke: async () => {
        await fetch(`${this.controlUrl}/grants/${encodeURIComponent(token)}`, {
          method: "DELETE",
          headers: { authorization: `Bearer ${this.controlToken}` },
          signal: AbortSignal.timeout(10_000),
        }).catch(() => undefined);
      },
    };
  }
}

/** Local mode: the same proxy, in-process on 127.0.0.1. */
class LocalEgress implements Egress {
  private readonly grants = new GrantStore();
  private address: Promise<string> | undefined;

  private start(): Promise<string> {
    this.address ??= new Promise((resolve) => {
      const server = createEgressProxy({
        grants: this.grants,
        log: logger.child({ service: "egress-local" }),
      });
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as AddressInfo;
        server.unref();
        resolve(`http://127.0.0.1:${port}`);
      });
    });
    return this.address;
  }

  async grant(label: string, origins: GrantedOrigin[], ttlSeconds: number): Promise<EgressGrant> {
    const server = await this.start();
    const token = newToken();
    this.grants.add(token, label, origins, ttlSeconds);
    return {
      proxy: { server, username: "run", password: token },
      revoke: async () => this.grants.remove(token),
    };
  }
}

let instance: Egress | undefined;

export function getEgress(): Egress {
  if (instance) return instance;
  const env = getEnv();
  if (env.SANDBOX_MODE === "local") {
    instance = new LocalEgress();
  } else {
    if (!env.EGRESS_CONTROL_URL || !env.EGRESS_CONTROL_TOKEN || !env.EGRESS_PROXY_URL) {
      throw new Error(
        "Egress proxy is not configured (EGRESS_CONTROL_URL / _TOKEN / EGRESS_PROXY_URL).",
      );
    }
    instance = new RemoteEgress(
      env.EGRESS_CONTROL_URL,
      env.EGRESS_CONTROL_TOKEN,
      env.EGRESS_PROXY_URL,
    );
  }
  return instance;
}

/** Tests only. */
export function setEgress(e: Egress | undefined): void {
  instance = e;
}
