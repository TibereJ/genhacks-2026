// Protection for public BlindSpot instances (BLINDSPOT_PUBLIC=1).
// The server drives a real browser to any URL it is given, which is a classic SSRF risk:
// without a guard, anyone could make it load http://169.254.169.254/ (cloud metadata),
// http://localhost:6379/ or other internal services. This module refuses URLs whose host
// resolves to a private, loopback, link-local or otherwise non-public address.
//
// The server checks the URL that starts a test, and BrowserSession.open runs checkPublicTarget on
// every request the browser makes (navigations, assets, new tabs, each hop of a redirect chain).
// Not covered: DNS rebinding (Chromium resolves the hostname again itself after this check) and
// WebSockets (context.route does not see them). Public deployments must also block private ranges
// at the network level; see "Known limits" in docs/DEPLOY.md.
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

/** Parses a dotted IPv4 address into 4 bytes, or undefined. */
function parseIPv4(ip: string): number[] | undefined {
  if (isIP(ip) !== 4) return undefined;
  return ip.split(".").map(Number);
}

/** Parses an IPv6 address (with optional zone id and embedded IPv4) into 8 16-bit groups, or undefined. */
function parseIPv6(input: string): number[] | undefined {
  const ip = input.replace(/%.*$/, "");
  if (isIP(ip) !== 6) return undefined;
  let head = ip;
  const tail: number[] = [];
  const v4 = /:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (v4) {
    const b = parseIPv4(v4[1]);
    if (!b) return undefined;
    tail.push((b[0] << 8) | b[1], (b[2] << 8) | b[3]);
    head = ip.slice(0, v4.index + 1); // keep the ':' so "::1.2.3.4" stays "::"
    if (head.endsWith(":") && !head.endsWith("::")) head = head.slice(0, -1);
  }
  const toGroups = (s: string) => (s === "" ? [] : s.split(":").map((g) => parseInt(g, 16)));
  let groups: number[];
  if (head.includes("::")) {
    const [l, r] = head.split("::");
    const left = toGroups(l);
    const right = toGroups(r);
    const fill = 8 - tail.length - left.length - right.length;
    if (fill < 0) return undefined;
    groups = [...left, ...new Array<number>(fill).fill(0), ...right, ...tail];
  } else {
    groups = [...toGroups(head), ...tail];
  }
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : undefined;
}

function isPrivateIPv4(b: number[]): boolean {
  const [a, c] = b;
  return (
    a === 0 || // 0.0.0.0/8 "this network" (0.0.0.0 reaches localhost on Linux)
    a === 10 || // 10.0.0.0/8 private
    a === 127 || // 127.0.0.0/8 loopback
    (a === 100 && c >= 64 && c <= 127) || // 100.64.0.0/10 carrier-grade NAT
    (a === 169 && c === 254) || // 169.254.0.0/16 link-local (cloud metadata)
    (a === 172 && c >= 16 && c <= 31) || // 172.16.0.0/12 private
    (a === 192 && c === 0 && b[2] === 0) || // 192.0.0.0/24 IETF protocol assignments
    (a === 192 && c === 168) || // 192.168.0.0/16 private
    (a === 198 && (c === 18 || c === 19)) || // 198.18.0.0/15 benchmarking
    a >= 224 // 224.0.0.0/4 multicast, 240.0.0.0/4 reserved, 255.255.255.255 broadcast
  );
}

/**
 * True when `ip` (IPv4 or IPv6 literal) is not a public unicast address: loopback, private,
 * link-local, unique-local, multicast, unspecified, or an IPv6 form embedding such an IPv4.
 * Anything that cannot be parsed counts as private, so the guard fails closed.
 */
export function isPrivateAddress(ip: string): boolean {
  const literal = ip.replace(/^\[|\]$/g, "");
  const v4 = parseIPv4(literal);
  if (v4) return isPrivateIPv4(v4);
  const g = parseIPv6(literal);
  if (!g) return true;

  const embeddedV4 = () => [g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff];
  const zeros = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (zeros(8)) return true; // :: unspecified
  if (zeros(7) && g[7] === 1) return true; // ::1 loopback
  if (zeros(5) && g[5] === 0xffff) return isPrivateIPv4(embeddedV4()); // ::ffff:a.b.c.d IPv4-mapped
  if (zeros(6)) return isPrivateIPv4(embeddedV4()); // ::a.b.c.d IPv4-compatible (deprecated)
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPrivateIPv4(embeddedV4()); // 64:ff9b::/96 NAT64
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

export type Lookup = (hostname: string) => Promise<string[]>;

const defaultLookup: Lookup = async (hostname) =>
  (await dnsLookup(hostname, { all: true, verbatim: true })).map((a) => a.address);

export interface GuardOptions {
  /** Port of this BlindSpot server: its own /demo/ pages stay allowed. */
  selfPort: number;
  lookup?: Lookup;
}

const SELF_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Resolves when `target` may be visited by a public instance; otherwise returns the reason it is refused. */
export async function checkPublicTarget(target: URL, opts: GuardOptions): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (target.protocol !== "http:" && target.protocol !== "https:") return { ok: false, reason: "Only http and https URLs can be tested" };
  const port = target.port || (target.protocol === "https:" ? "443" : "80");
  // URL parsing already collapsed "..", so "/demo/../api" can't sneak through here.
  if (SELF_HOSTS.has(target.hostname) && port === String(opts.selfPort) && target.pathname.startsWith("/demo/")) return { ok: true };

  const host = target.hostname.replace(/^\[|\]$/g, "");
  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = await (opts.lookup ?? defaultLookup)(host);
    } catch {
      return { ok: false, reason: `Could not resolve ${host}` };
    }
  }
  if (addresses.length === 0) return { ok: false, reason: `Could not resolve ${host}` };
  if (addresses.some(isPrivateAddress)) {
    return { ok: false, reason: "This public instance only tests public websites (the URL points to a private or local address)" };
  }
  return { ok: true };
}

/** BLINDSPOT_PUBLIC=1 turns on the protections for an internet-facing instance. */
export const isPublicInstance = (env: NodeJS.ProcessEnv = process.env) => env.BLINDSPOT_PUBLIC === "1";

/** On a public instance the Claude brain (which spends the API key) is off unless BLINDSPOT_ALLOW_CLAUDE=1. */
export const claudeAllowed = (env: NodeJS.ProcessEnv = process.env) => !isPublicInstance(env) || env.BLINDSPOT_ALLOW_CLAUDE === "1";
