import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getEnv } from "@/server/env";
import { AppError } from "@/server/errors";

/**
 * AES-256-GCM envelope: "v<keyVersion>:<iv b64>:<tag b64>:<ciphertext b64>".
 * A fresh 96-bit IV per value; the auth tag makes tampering detectable.
 */
const ALGO = "aes-256-gcm";

type KeyRing = Map<number, Buffer>;

export function parseKeyRing(spec: string | undefined): KeyRing {
  const ring: KeyRing = new Map();
  for (const part of (spec ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)) {
    const m = /^(\d{1,4}):([A-Za-z0-9+/=_-]+)$/.exec(part);
    if (!m) throw new Error("CREDENTIALS_ENCRYPTION_KEYS is malformed.");
    const key = Buffer.from(m[2] ?? "", "base64");
    if (key.length !== 32)
      throw new Error("Each credentials encryption key must be 32 bytes (base64).");
    ring.set(Number(m[1]), key);
  }
  return ring;
}

let cachedRing: KeyRing | undefined;

function ring(): KeyRing {
  cachedRing ??= parseKeyRing(getEnv().CREDENTIALS_ENCRYPTION_KEYS);
  if (cachedRing.size === 0) {
    throw new AppError(
      503,
      "NOT_CONFIGURED",
      "Saving test credentials isn't set up yet. Ask an Admin to configure the encryption key.",
    );
  }
  return cachedRing;
}

/** Tests only. */
export function resetKeyRing(): void {
  cachedRing = undefined;
}

export function encryptBuffer(plain: Buffer, keys: KeyRing = ring()): string {
  const version = Math.max(...keys.keys());
  const key = keys.get(version);
  if (!key) throw new Error("No encryption key.");
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v${version}:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export function decryptBuffer(envelope: string, keys: KeyRing = ring()): Buffer {
  const m = /^v(\d+):([^:]+):([^:]+):([^:]*)$/.exec(envelope);
  if (!m) throw new Error("Malformed encrypted value.");
  const key = keys.get(Number(m[1]));
  if (!key) throw new Error("Encrypted with an unknown key version.");
  const decipher = createDecipheriv(ALGO, key, Buffer.from(m[2] ?? "", "base64"));
  decipher.setAuthTag(Buffer.from(m[3] ?? "", "base64"));
  return Buffer.concat([decipher.update(Buffer.from(m[4] ?? "", "base64")), decipher.final()]);
}

export const encryptString = (plain: string, keys?: KeyRing) =>
  encryptBuffer(Buffer.from(plain, "utf8"), keys);
export const decryptString = (envelope: string, keys?: KeyRing) =>
  decryptBuffer(envelope, keys).toString("utf8");

/** Display-safe hint: "j***@acme.com", "a***n". Never reveals more than 2 characters. */
export function maskUsername(username: string): string {
  const at = username.indexOf("@");
  if (at > 0) return `${username[0]}***${username.slice(at)}`;
  if (username.length <= 2) return "***";
  return `${username[0]}***${username[username.length - 1]}`;
}
