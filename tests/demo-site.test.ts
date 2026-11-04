// Tests for the demo clinic site (demo-site/). The fixed version must be fully usable
// through accessible names and roles; the bad version must contain the documented
// barriers; both must render pixel-identically so the before/after demo is fair.
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";

const ROOT = fileURLToPath(new URL("../demo-site/", import.meta.url));
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

let server: Server;
let browser: Browser;
let base: string;

beforeAll(async () => {
  // Serve demo-site/ at /demo/, like src/server.ts does.
  server = createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
    const file = path.resolve(ROOT, "." + pathname.replace(/^\/demo\//, "/"));
    if (!pathname.startsWith("/demo/") || !file.startsWith(ROOT)) {
      res.writeHead(404).end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no server address");
  base = `http://127.0.0.1:${address.port}/demo`;
  browser = await chromium.launch();
}, 30_000);

afterAll(async () => {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
});

async function newPage(): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  return context.newPage();
}

interface AXNode {
  ignored: boolean;
  role?: { value?: unknown };
  name?: { value?: unknown };
}

/** Non-ignored nodes of Chromium's accessibility tree, as role + name. */
async function axTree(page: Page): Promise<{ role: string; name: string }[]> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Accessibility.enable");
  const { nodes } = (await cdp.send("Accessibility.getFullAXTree")) as { nodes: AXNode[] };
  await cdp.detach();
  return nodes
    .filter((n) => !n.ignored)
    .map((n) => ({ role: String(n.role?.value ?? ""), name: String(n.name?.value ?? "") }));
}

const OPERABLE = new Set(["button", "link", "textbox", "combobox", "radio", "checkbox", "option", "menuitem", "tab", "switch", "date", "DateTime", "PopUpButton"]);
const SLOT_TIMES = ["9:00", "10:30", "14:00", "16:15"];

describe("demo-site fixed version", () => {
  it("can be booked end to end with accessible names and roles only", async () => {
    const page = await newPage();
    await page.goto(`${base}/fixed/index.html`);
    await expect(page.getByRole("img", { name: "Maple Grove Clinic home" }).count()).resolves.toBe(1);
    await expect(page.getByRole("link", { name: "Book", exact: true }).count()).resolves.toBe(1);

    await page.getByRole("main").getByRole("link", { name: "Book an appointment" }).click();
    await page.waitForURL(/\/fixed\/book\.html$/);

    await page.getByLabel("Doctor").selectOption({ label: "Dr. Lee — Family medicine" });
    await expect(page.getByLabel("Date").inputValue()).resolves.toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await page.getByLabel("Full name").fill("Alex Doe");
    await page.getByLabel("Email").fill("alex@example.com");

    // Submitting without a time is announced through role="alert" and moves focus to the group.
    await page.getByRole("button", { name: "Book appointment" }).click();
    await expect(page.getByRole("alert").textContent()).resolves.toBe("Please choose a time slot.");
    const focused = await page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.value);
    expect(focused).toBe("9:00");
    const group = page.getByRole("group", { name: "Available times" });
    await expect(group.getAttribute("aria-describedby")).resolves.toBe("form-error");

    await expect(group.getByRole("radio").count()).resolves.toBe(5);
    await expect(page.getByRole("radio", { name: "11:45" }).isDisabled()).resolves.toBe(true);
    await page.getByRole("radio", { name: "14:00" }).check();
    await expect(page.getByRole("alert").textContent()).resolves.toBe("");

    await page.getByRole("button", { name: "Book appointment" }).click();
    await page.waitForURL(/\/fixed\/confirm\.html\?/);
    await expect(page.getByRole("heading", { level: 1 }).textContent()).resolves.toBe("Appointment confirmed");
    const details = await page.locator("dl.details").innerText();
    expect(details).toContain("Dr. Lee");
    expect(details).toContain("14:00");
    expect(details).toContain("Alex Doe");
    await page.context().close();
  }, 30_000);

  it("has no nameless operable element and no skipped heading level", async () => {
    const page = await newPage();
    for (const p of ["index.html", "book.html"]) {
      await page.goto(`${base}/fixed/${p}`);
      const nodes = await axTree(page);
      const nameless = nodes.filter((n) => OPERABLE.has(n.role) && n.name.trim() === "");
      expect(nameless, `${p}: ${JSON.stringify(nameless)}`).toEqual([]);
      expect(nodes.filter((n) => n.role === "image" && !n.name), p).toEqual([]);
    }
    await page.goto(`${base}/fixed/index.html`);
    const levels = await page.$$eval("h1,h2,h3,h4,h5,h6", (hs) => hs.map((h) => Number(h.tagName[1])));
    levels.forEach((level, i) => expect(level - (levels[i - 1] ?? 0)).toBeLessThanOrEqual(1));
    await page.context().close();
  }, 30_000);
});

describe("demo-site bad version", () => {
  it("keeps the home page CTA working so the agent reaches the form", async () => {
    const page = await newPage();
    await page.goto(`${base}/bad/index.html`);
    await page.getByRole("main").getByRole("link", { name: "Book an appointment" }).click();
    await page.waitForURL(/\/bad\/book\.html$/);
    await page.context().close();
  }, 30_000);

  it("exposes the documented barriers in the accessibility tree", async () => {
    const page = await newPage();

    await page.goto(`${base}/bad/index.html`);
    let nodes = await axTree(page);
    // Logo without alt, inside a link that therefore has no name; icon-only Book link.
    await expect(page.locator("img.logo").getAttribute("alt")).resolves.toBeNull();
    expect(nodes.filter((n) => n.role === "link" && n.name === "").length).toBe(2);
    const levels = await page.$$eval("h1,h2,h3,h4,h5,h6", (hs) => hs.map((h) => Number(h.tagName[1])));
    expect(levels.slice(0, 2)).toEqual([1, 4]);

    await page.goto(`${base}/bad/book.html`);
    nodes = await axTree(page);

    // BLOCKER: the time slots are not radios, buttons or anything else operable.
    await expect(page.getByRole("radio").count()).resolves.toBe(0);
    await expect(page.getByRole("button").count()).resolves.toBe(1); // only the submit arrow
    for (const time of SLOT_TIMES) {
      const matches = nodes.filter((n) => n.name === time);
      expect(matches.length, time).toBeGreaterThan(0);
      for (const m of matches) expect(OPERABLE.has(m.role), `${time} is ${m.role}`).toBe(false);
    }
    const slotTabIndex = await page.$$eval(".slot", (els) => els.map((el) => (el as HTMLElement).tabIndex));
    expect(slotTabIndex.every((t) => t === -1)).toBe(true);

    // Submit button with no accessible name. (The other AX button is Chromium's built-in
    // "Show date picker" inside <input type="date">.)
    const buttons = nodes.filter((n) => n.role === "button" && !/date picker/i.test(n.name));
    expect(buttons).toEqual([{ role: "button", name: "" }]);
    await expect(page.locator("button.submit-arrow").evaluate((el) => el.textContent?.trim())).resolves.toBe("");

    // Doctor select without a label; email without label or placeholder.
    expect(nodes.filter((n) => n.role === "combobox").map((n) => n.name)).toEqual([""]);
    await expect(page.locator("#name").getAttribute("placeholder")).resolves.toBe("Full name");
    await expect(page.locator("label[for=name]").count()).resolves.toBe(0);
    await expect(page.locator("#email").evaluate((el: HTMLInputElement) => el.labels?.length ?? 0)).resolves.toBe(0);
    // Date is the one field that is done right.
    await expect(page.getByLabel("Date").count()).resolves.toBe(1);

    // The error is visible red text but not a live region, so it is never announced.
    await page.getByRole("button").click();
    await expect(page.locator(".form-error").textContent()).resolves.toBe("Please choose a doctor.");
    await page.locator("#doctor").selectOption("Dr. Lee");
    await page.getByRole("button").click();
    await expect(page.locator(".form-error").textContent()).resolves.toBe("Please choose a time slot.");
    await expect(page.getByRole("alert").count()).resolves.toBe(0);
    await expect(page.locator("[aria-live]").count()).resolves.toBe(0);
    await page.context().close();
  }, 30_000);

  it("still works for a sighted mouse user", async () => {
    const page = await newPage();
    await page.goto(`${base}/bad/book.html`);
    await page.locator("#doctor").selectOption("Dr. Lee");
    await page.locator(".slot", { hasText: "10:30" }).click();
    await page.locator("#name").fill("Alex Doe");
    await page.locator("#email").fill("alex@example.com");
    await page.locator("button.submit-arrow").click();
    await page.waitForURL(/\/bad\/confirm\.html\?/);
    await expect(page.locator("h1").textContent()).resolves.toBe("Appointment confirmed");
    await expect(page.locator("[data-field=time]").textContent()).resolves.toBe("10:30");
    await page.context().close();
  }, 30_000);
});

describe("demo-site visual parity", () => {
  async function shot(page: Page, url: string, prepare?: (page: Page) => Promise<void>): Promise<Buffer> {
    await page.goto(url);
    if (prepare) await prepare(page);
    await page.mouse.move(0, 0);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    return page.screenshot({ fullPage: true });
  }

  const confirmQuery = "confirm.html?doctor=Dr.+Lee&date=2026-11-20&time=14%3A00&name=Alex+Doe";
  const states: [string, string, ((page: Page, version: string) => Promise<void>) | undefined][] = [
    ["home", "index.html", undefined],
    ["booking form", "book.html", undefined],
    ["confirmation", confirmQuery, undefined],
    [
      "slot selected",
      "book.html",
      async (page, version) => {
        if (version === "fixed") await page.getByRole("radio", { name: "14:00" }).check();
        else await page.locator(".slot", { hasText: "14:00" }).click();
      },
    ],
    [
      "time error shown",
      "book.html",
      async (page) => {
        await page.locator("#doctor").selectOption("Dr. Lee");
        await page.locator(version(page) === "fixed" ? "button.submit-pill" : "button.submit-arrow").click();
      },
    ],
  ];
  const version = (page: Page) => (page.url().includes("/fixed/") ? "fixed" : "bad");

  for (const [label, file, prepare] of states) {
    it(`bad and fixed render identically: ${label}`, async () => {
      const page = await newPage();
      const bad = await shot(page, `${base}/bad/${file}`, prepare && ((p) => prepare(p, "bad")));
      const fixed = await shot(page, `${base}/fixed/${file}`, prepare && ((p) => prepare(p, "fixed")));
      expect(bad.equals(fixed)).toBe(true);
      await page.context().close();
    }, 30_000);
  }
});
