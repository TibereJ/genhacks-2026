import { describe, expect, it } from "vitest";
import { checkPublicTarget, claudeAllowed, isPrivateAddress, isPublicInstance } from "../src/core/url-guard.js";

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1", "127.255.255.254", "10.0.0.1", "10.255.255.255", "172.16.0.1", "172.31.255.255",
    "192.168.0.1", "192.168.255.255", "169.254.169.254", "169.254.0.1", "0.0.0.0", "0.1.2.3",
    "100.64.0.1", "100.127.255.255", "198.18.0.1", "224.0.0.1", "255.255.255.255",
  ])("IPv4 %s is private", (ip) => expect(isPrivateAddress(ip)).toBe(true));

  it.each(["8.8.8.8", "1.1.1.1", "172.15.255.255", "172.32.0.1", "192.169.0.1", "169.253.0.1", "100.63.255.255", "100.128.0.1", "11.0.0.1", "126.255.255.255", "128.0.0.1"])(
    "IPv4 %s is public",
    (ip) => expect(isPrivateAddress(ip)).toBe(false),
  );

  it.each([
    "::1", "0:0:0:0:0:0:0:1", "[::1]", "::",
    "fc00::1", "fd12:3456:789a::1", "fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    "fe80::1", "fe80::1%eth0", "febf:ffff::1", "ff02::1",
    // IPv4-mapped / embedded IPv4 forms of private addresses
    "::ffff:127.0.0.1", "::ffff:7f00:1", "[::ffff:7f00:1]", "::ffff:10.1.2.3", "::ffff:a9fe:a9fe", "0:0:0:0:0:ffff:192.168.1.1",
    "::127.0.0.1", "64:ff9b::10.0.0.1",
  ])("IPv6 %s is private", (ip) => expect(isPrivateAddress(ip)).toBe(true));

  it.each(["2001:4860:4860::8888", "2606:4700:4700::1111", "::ffff:8.8.8.8", "::ffff:808:808", "fbff::1", "2a00::1", "64:ff9b::8.8.8.8"])(
    "IPv6 %s is public",
    (ip) => expect(isPrivateAddress(ip)).toBe(false),
  );

  it("fails closed on anything that is not an IP", () => {
    expect(isPrivateAddress("not-an-ip")).toBe(true);
    expect(isPrivateAddress("")).toBe(true);
    expect(isPrivateAddress("999.1.1.1")).toBe(true);
  });
});

describe("checkPublicTarget", () => {
  const lookup = (table: Record<string, string[]>) => async (host: string) => {
    if (!(host in table)) throw new Error("ENOTFOUND");
    return table[host];
  };
  const opts = { selfPort: 3000, lookup: lookup({ "example.com": ["93.184.215.14", "2606:2800:21f:cb07:6820:80da:af6b:8b2c"], "evil.test": ["93.184.215.14", "10.0.0.5"], "metadata.test": ["169.254.169.254"], localhost: ["127.0.0.1"] }) };
  const check = (url: string) => checkPublicTarget(new URL(url), opts);

  it("allows public hosts", async () => {
    expect(await check("https://example.com/book")).toEqual({ ok: true });
  });

  it("refuses hosts that resolve to a private address (any of them)", async () => {
    expect((await check("http://evil.test/")).ok).toBe(false);
    expect((await check("http://metadata.test/latest/meta-data/")).ok).toBe(false);
    expect((await check("http://localhost:6379/")).ok).toBe(false);
  });

  it("refuses private IP literals, including IPv6 and mapped forms", async () => {
    for (const url of ["http://127.0.0.1:3000/api/reports", "http://169.254.169.254/", "http://[::1]:8080/", "http://[::ffff:127.0.0.1]/", "http://[fd00::1]/", "http://0.0.0.0:3000/", "http://2130706433/", "http://0x7f.1/"]) {
      expect((await check(url)).ok, url).toBe(false);
    }
  });

  it("refuses unresolvable hosts and non-http schemes", async () => {
    expect(await check("http://nope.invalid/")).toEqual({ ok: false, reason: "Could not resolve nope.invalid" });
    expect((await check("file:///etc/passwd")).ok).toBe(false);
  });

  it("allows only this server's own /demo/ pages on localhost", async () => {
    expect((await check("http://localhost:3000/demo/bad/index.html")).ok).toBe(true);
    expect((await check("http://127.0.0.1:3000/demo/fixed/book.html")).ok).toBe(true);
    expect((await check("http://localhost:3000/demo/../api/reports")).ok).toBe(false);
    expect((await check("http://localhost:3000/demo%2f..%2fapi")).ok).toBe(false);
    expect((await check("http://localhost:3001/demo/bad/index.html")).ok).toBe(false);
    expect((await check("http://localhost:3000/api/reports")).ok).toBe(false);
  });
});

describe("public mode flags", () => {
  it("reads BLINDSPOT_PUBLIC and BLINDSPOT_ALLOW_CLAUDE", () => {
    expect(isPublicInstance({})).toBe(false);
    expect(claudeAllowed({})).toBe(true);
    expect(isPublicInstance({ BLINDSPOT_PUBLIC: "1" })).toBe(true);
    expect(claudeAllowed({ BLINDSPOT_PUBLIC: "1" })).toBe(false);
    expect(claudeAllowed({ BLINDSPOT_PUBLIC: "1", BLINDSPOT_ALLOW_CLAUDE: "1" })).toBe(true);
  });
});
