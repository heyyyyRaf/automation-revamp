/**
 * Minimal Docker Engine API client (create / attach / start / wait / kill / remove / list).
 * Talks to a unix socket or to a docker-socket-proxy over TCP (DOCKER_HOST=tcp://host:port).
 */
import http from "node:http";
import type { Duplex } from "node:stream";

const API = "/v1.43";

export interface DockerTarget {
  socketPath?: string;
  host?: string;
  port?: number;
}

export function dockerTargetFromEnv(env = process.env): DockerTarget {
  const host = env.DOCKER_HOST ?? "unix:///var/run/docker.sock";
  if (host.startsWith("unix://")) return { socketPath: host.slice("unix://".length) };
  const u = new URL(host.replace(/^tcp:/, "http:"));
  return { host: u.hostname, port: Number(u.port || 2375) };
}

export class DockerClient {
  constructor(private readonly target: DockerTarget) {}

  private request(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    return http.request({
      ...this.target,
      method,
      path: `${API}${path}`,
      headers: {
        ...(payload
          ? { "content-type": "application/json", "content-length": String(payload.length) }
          : {}),
        ...headers,
      },
    });
  }

  async json<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; data: T }> {
    const req = this.request(method, path, body);
    return new Promise((resolve, reject) => {
      req.on("response", (res) => {
        let raw = "";
        res.on("data", (c: Buffer) => (raw += c.toString("utf8")));
        res.on("end", () => {
          const status = res.statusCode ?? 500;
          let data: unknown = null;
          try {
            data = raw ? JSON.parse(raw) : null;
          } catch {
            data = raw;
          }
          if (status >= 400) reject(new Error(`docker ${method} ${path} → ${status}`));
          else resolve({ status, data: data as T });
        });
      });
      req.on("error", reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }

  /** Hijacked attach connection: write = container stdin, read = multiplexed stdout/stderr. */
  attach(id: string): Promise<Duplex> {
    const req = this.request(
      "POST",
      `/containers/${encodeURIComponent(id)}/attach?stream=1&stdin=1&stdout=1&stderr=1`,
      undefined,
      { Connection: "Upgrade", Upgrade: "tcp" },
    );
    return new Promise((resolve, reject) => {
      req.on("upgrade", (_res, socket) => resolve(socket));
      req.on("response", (res) => reject(new Error(`attach failed: ${res.statusCode}`)));
      req.on("error", reject);
      req.end();
    });
  }
}

/**
 * Splits Docker's multiplexed stream ([type, 0, 0, 0, size BE32] + payload) into stdout text.
 * stderr frames are passed to `onStderr`.
 */
export function demultiplex(onStdout: (chunk: Buffer) => void, onStderr: (chunk: Buffer) => void) {
  let buffer = Buffer.alloc(0);
  return (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 8) {
      const size = buffer.readUInt32BE(4);
      if (buffer.length < 8 + size) return;
      const type = buffer[0];
      const payload = buffer.subarray(8, 8 + size);
      if (type === 2) onStderr(payload);
      else onStdout(payload);
      buffer = buffer.subarray(8 + size);
    }
  };
}
