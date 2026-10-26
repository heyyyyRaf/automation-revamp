import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

/**
 * SSRF protection shared by the API (when targets are saved) and the egress proxy
 * (on every connection, after DNS resolution — so DNS rebinding cannot slip through).
 */

/** Never reachable, even for targets an Admin marked "private network allowed". */
const ALWAYS_BLOCKED = new BlockList();
ALWAYS_BLOCKED.addSubnet("0.0.0.0", 8, "ipv4"); // "this" network
ALWAYS_BLOCKED.addSubnet("169.254.0.0", 16, "ipv4"); // link-local, cloud metadata (169.254.169.254)
ALWAYS_BLOCKED.addSubnet("224.0.0.0", 4, "ipv4"); // multicast
ALWAYS_BLOCKED.addSubnet("240.0.0.0", 4, "ipv4"); // reserved + broadcast
ALWAYS_BLOCKED.addAddress("::", "ipv6");
ALWAYS_BLOCKED.addSubnet("fe80::", 10, "ipv6"); // link-local
ALWAYS_BLOCKED.addSubnet("ff00::", 8, "ipv6"); // multicast
ALWAYS_BLOCKED.addAddress("fd00:ec2::254", "ipv6"); // AWS IPv6 metadata

/** Internal addresses: allowed only when an Admin explicitly approved private access. */
const PRIVATE = new BlockList();
PRIVATE.addSubnet("10.0.0.0", 8, "ipv4");
PRIVATE.addSubnet("172.16.0.0", 12, "ipv4");
PRIVATE.addSubnet("192.168.0.0", 16, "ipv4");
PRIVATE.addSubnet("127.0.0.0", 8, "ipv4");
PRIVATE.addSubnet("100.64.0.0", 10, "ipv4"); // carrier-grade NAT
PRIVATE.addSubnet("198.18.0.0", 15, "ipv4"); // benchmarking
PRIVATE.addAddress("::1", "ipv6");
PRIVATE.addSubnet("fc00::", 7, "ipv6"); // unique local

export type AddressVerdict = "public" | "private" | "blocked";

export function classifyAddress(ip: string): AddressVerdict {
  const family = isIP(ip);
  if (family === 0) return "blocked";
  // IPv4-mapped IPv6 (::ffff:10.0.0.1) is judged as the IPv4 address it maps to.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped?.[1]) return classifyAddress(mapped[1]);
  const type = family === 4 ? "ipv4" : "ipv6";
  if (ALWAYS_BLOCKED.check(ip, type)) return "blocked";
  if (PRIVATE.check(ip, type)) return "private";
  return "public";
}

export function isAddressAllowed(ip: string, allowPrivate: boolean): boolean {
  const verdict = classifyAddress(ip);
  return verdict === "public" || (verdict === "private" && allowPrivate);
}

/** "https://App.Example.com:443/x" → "https://app.example.com". Only http(s), no credentials. */
export function normalizeOrigin(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password || !u.hostname) return null;
  return u.origin;
}

export type Resolver = (host: string) => Promise<string[]>;

export const systemResolver: Resolver = async (host) =>
  (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

/**
 * Resolves a host and returns one address that is allowed to be contacted, or a reason.
 * Every resolved address must pass — a host resolving to a mix of public and private
 * addresses is refused unless private access was approved.
 */
export async function resolveAllowed(
  host: string,
  allowPrivate: boolean,
  resolve: Resolver = systemResolver,
): Promise<{ ok: true; address: string } | { ok: false; reason: string }> {
  const bare = host.replace(/^\[|\]$/g, "");
  let addresses: string[];
  try {
    addresses = isIP(bare) ? [bare] : await resolve(bare);
  } catch {
    return { ok: false, reason: "The address could not be resolved." };
  }
  if (addresses.length === 0) return { ok: false, reason: "The address could not be resolved." };
  for (const a of addresses) {
    if (!isAddressAllowed(a, allowPrivate)) {
      return {
        ok: false,
        reason:
          classifyAddress(a) === "blocked"
            ? "This address is never allowed (link-local, metadata or reserved)."
            : "This address is on a private network. An Admin must approve private access for it.",
      };
    }
  }
  return { ok: true, address: addresses[0] ?? "" };
}
