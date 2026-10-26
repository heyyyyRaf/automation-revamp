import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { decryptString, encryptString, maskUsername, parseKeyRing } from "@/server/crypto/secrets";
import { createEgressProxy, GrantStore } from "@/server/egress/proxy";
import { createLogger } from "@/server/logger";
import { classifyAddress, normalizeOrigin, resolveAllowed } from "@/server/net/url-guard";
import { MASK, parseEventLine, scrub, secretVariants } from "@/server/sandbox/protocol";

const key = (b: number) => Buffer.alloc(32, b).toString("base64");

describe("credential encryption (AES-256-GCM)", () => {
  const ring = parseKeyRing(`1:${key(1)}`);

  it("round-trips, uses a fresh IV each time, and never stores plaintext", () => {
    const a = encryptString("hunter2-secret", ring);
    const b = encryptString("hunter2-secret", ring);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^v1:[^:]+:[^:]+:[^:]+$/);
    expect(a).not.toContain("hunter2");
    expect(decryptString(a, ring)).toBe("hunter2-secret");
  });

  it("detects tampering", () => {
    const parts = encryptString("value", ring).split(":");
    const ct = Buffer.from(parts[3]!, "base64");
    ct[0] = (ct[0] ?? 0) ^ 0xff;
    parts[3] = ct.toString("base64");
    expect(() => decryptString(parts.join(":"), ring)).toThrow();
  });

  it("supports key rotation: new values use the newest key, old values still decrypt", () => {
    const old = encryptString("old", ring);
    const rotated = parseKeyRing(`1:${key(1)},2:${key(2)}`);
    const fresh = encryptString("new", rotated);
    expect(fresh.startsWith("v2:")).toBe(true);
    expect(decryptString(old, rotated)).toBe("old");
    expect(() => decryptString(fresh, ring)).toThrow(); // unknown key version
  });

  it("rejects malformed key configuration", () => {
    expect(() => parseKeyRing("1:short")).toThrow();
    expect(() => parseKeyRing("nonsense")).toThrow();
  });

  it("masks usernames for display", () => {
    expect(maskUsername("jane.doe@acme.com")).toBe("j***@acme.com");
    expect(maskUsername("administrator")).toBe("a***r");
    expect(maskUsername("ab")).toBe("***");
  });
});

describe("SSRF guard", () => {
  it("classifies addresses", () => {
    for (const ip of [
      "169.254.169.254",
      "0.0.0.0",
      "224.0.0.1",
      "255.255.255.255",
      "fe80::1",
      "::",
      "::ffff:169.254.169.254",
    ]) {
      expect(classifyAddress(ip)).toBe("blocked");
    }
    for (const ip of [
      "10.1.2.3",
      "172.16.0.1",
      "192.168.1.1",
      "127.0.0.1",
      "::1",
      "fd12::1",
      "100.64.0.1",
      "::ffff:10.0.0.1",
    ]) {
      expect(classifyAddress(ip)).toBe("private");
    }
    for (const ip of ["8.8.8.8", "93.184.216.34", "2606:4700::1111"])
      expect(classifyAddress(ip)).toBe("public");
    expect(classifyAddress("not-an-ip")).toBe("blocked");
  });

  it("normalizes origins and rejects non-http(s) or credentialed URLs", () => {
    expect(normalizeOrigin("https://App.Example.com:443/login?x=1")).toBe(
      "https://app.example.com",
    );
    expect(normalizeOrigin("http://example.com:8080")).toBe("http://example.com:8080");
    for (const bad of [
      "ftp://x.com",
      "javascript:alert(1)",
      "https://user:pw@x.com",
      "file:///etc/passwd",
      "not a url",
    ]) {
      expect(normalizeOrigin(bad)).toBeNull();
    }
  });

  it("refuses hosts that resolve to private or metadata addresses (DNS rebinding included)", async () => {
    const resolveTo = (ips: string[]) => async () => ips;
    expect(await resolveAllowed("evil.test", false, resolveTo(["169.254.169.254"]))).toMatchObject({
      ok: false,
    });
    expect(await resolveAllowed("evil.test", true, resolveTo(["169.254.169.254"]))).toMatchObject({
      ok: false,
    });
    expect(await resolveAllowed("intranet.test", false, resolveTo(["10.0.0.5"]))).toMatchObject({
      ok: false,
    });
    expect(await resolveAllowed("intranet.test", true, resolveTo(["10.0.0.5"]))).toEqual({
      ok: true,
      address: "10.0.0.5",
    });
    // A mix of public and private answers is refused unless private access was approved.
    expect(
      await resolveAllowed("mixed.test", false, resolveTo(["8.8.8.8", "127.0.0.1"])),
    ).toMatchObject({ ok: false });
    expect(await resolveAllowed("good.test", false, resolveTo(["8.8.8.8"]))).toEqual({
      ok: true,
      address: "8.8.8.8",
    });
  });
});

describe("egress proxy", () => {
  async function setup() {
    const target = http.createServer((_req, res) => res.end("hello from target"));
    await new Promise<void>((r) => target.listen(0, "127.0.0.1", r));
    const targetPort = (target.address() as AddressInfo).port;
    const grants = new GrantStore();
    const proxy = createEgressProxy({ grants, log: createLogger({ level: "silent" }) });
    await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
    const proxyPort = (proxy.address() as AddressInfo).port;
    return {
      grants,
      targetOrigin: `http://127.0.0.1:${targetPort}`,
      targetPort,
      proxyPort,
      close: () =>
        Promise.all([new Promise((r) => target.close(r)), new Promise((r) => proxy.close(r))]),
    };
  }

  const viaProxy = (proxyPort: number, url: string, token?: string) =>
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port: proxyPort,
          method: "GET",
          path: url,
          headers: token
            ? { "proxy-authorization": `Basic ${Buffer.from(`run:${token}`).toString("base64")}` }
            : {},
        },
        (res) => {
          let body = "";
          res.on("data", (c: Buffer) => (body += c.toString()));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
        },
      );
      req.on("error", reject);
      req.end();
    });

  const connectVia = (proxyPort: number, hostPort: string, token: string) =>
    new Promise<string>((resolve, reject) => {
      const s = net.connect(proxyPort, "127.0.0.1", () => {
        s.write(
          `CONNECT ${hostPort} HTTP/1.1\r\nHost: ${hostPort}\r\nProxy-Authorization: Basic ${Buffer.from(`run:${token}`).toString("base64")}\r\n\r\n`,
        );
      });
      s.once("data", (d: Buffer) => {
        resolve(d.toString().split("\r\n")[0] ?? "");
        s.destroy();
      });
      s.on("error", reject);
    });

  it("forwards only granted origins for a valid run token", async () => {
    const env = await setup();
    try {
      env.grants.add("tok-1", "run", [{ origin: env.targetOrigin, allowPrivate: true }], 60);
      expect(await viaProxy(env.proxyPort, `${env.targetOrigin}/`, "tok-1")).toEqual({
        status: 200,
        body: "hello from target",
      });
      expect((await viaProxy(env.proxyPort, `${env.targetOrigin}/`)).status).toBe(407); // no credentials
      expect((await viaProxy(env.proxyPort, `${env.targetOrigin}/`, "wrong")).status).toBe(407);
      expect((await viaProxy(env.proxyPort, "http://127.0.0.1:1/", "tok-1")).status).toBe(403); // other origin
      expect(await connectVia(env.proxyPort, `127.0.0.1:${env.targetPort}`, "tok-1")).toMatch(
        /200 Connection Established/,
      );
      expect(await connectVia(env.proxyPort, "169.254.169.254:80", "tok-1")).toMatch(/403/);
    } finally {
      await env.close();
    }
  });

  it("refuses private addresses unless the grant allows them, and expires grants", async () => {
    const env = await setup();
    try {
      env.grants.add("tok-2", "run", [{ origin: env.targetOrigin, allowPrivate: false }], 60);
      expect((await viaProxy(env.proxyPort, `${env.targetOrigin}/`, "tok-2")).status).toBe(403);
      env.grants.add("tok-3", "run", [{ origin: env.targetOrigin, allowPrivate: true }], 0);
      await new Promise((r) => setTimeout(r, 10));
      expect((await viaProxy(env.proxyPort, `${env.targetOrigin}/`, "tok-3")).status).toBe(407);
      env.grants.add("tok-4", "run", [{ origin: env.targetOrigin, allowPrivate: true }], 60);
      env.grants.remove("tok-4");
      expect((await viaProxy(env.proxyPort, `${env.targetOrigin}/`, "tok-4")).status).toBe(407);
    } finally {
      await env.close();
    }
  });
});

describe("sandbox protocol", () => {
  it("accepts only well-formed events and drops everything else", () => {
    expect(parseEventLine('{"t":"test-begin","id":"abc"}')).toEqual({ t: "test-begin", id: "abc" });
    expect(parseEventLine('{"t":"rm -rf"}')).toBeNull();
    expect(parseEventLine("not json")).toBeNull();
    expect(
      parseEventLine(`{"t":"log","id":null,"stream":"stdout","text":"${"x".repeat(5000)}"}`),
    ).toBeNull();
  });

  it("scrubs secrets in all their encoded forms", () => {
    const v = secretVariants(['p@ss "word"/1', "ab"]);
    expect(scrub('typed p@ss "word"/1 here', v)).toBe(`typed ${MASK} here`);
    expect(scrub(`json: "p@ss \\"word\\"/1"`, v)).toBe(`json: "${MASK}"`);
    expect(scrub(`form: password=${encodeURIComponent('p@ss "word"/1')}`, v)).toBe(
      `form: password=${MASK}`,
    );
    expect(scrub("ab stays (too short to scrub safely)", v)).toContain("ab stays");
  });
});
