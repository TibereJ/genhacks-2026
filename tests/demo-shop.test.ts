// Tests for the second demo site, GreenCart (demo-site/shop/). The fixed version must be
// fully usable through accessible names, roles and the keyboard; the bad version must contain
// the documented barriers (terms checkbox = blocker); both must render pixel-identically.
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
  base = `http://127.0.0.1:${address.port}/demo/shop`;
  browser = await chromium.launch();
}, 30_000);

afterAll(async () => {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
});

/** A fresh browser context, so the cookie banner shows like on a first visit. */
async function newPage(): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  return context.newPage();
}

/** Puts state in the version's localStorage namespace, then reloads `file`. */
async function seed(page: Page, version: string, file: string, state: Record<string, unknown>): Promise<void> {
  await page.goto(`${base}/${version}/${file}`);
  await page.evaluate(
    ([v, s]) => {
      for (const [k, value] of Object.entries(s)) localStorage.setItem(`greencart:${v}:${k}`, JSON.stringify(value));
    },
    [version, state] as const,
  );
  await page.goto(`${base}/${version}/${file}`);
}

interface AXNode {
  ignored: boolean;
  role?: { value?: unknown };
  name?: { value?: unknown };
  properties?: { name: string; value: { value?: unknown } }[];
}

/** Non-ignored nodes of Chromium's accessibility tree, as role + name + focusable. */
async function axTree(page: Page): Promise<{ role: string; name: string; focusable: boolean; props: string[] }[]> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Accessibility.enable");
  const { nodes } = (await cdp.send("Accessibility.getFullAXTree")) as { nodes: AXNode[] };
  await cdp.detach();
  return nodes
    .filter((n) => !n.ignored)
    .map((n) => ({
      role: String(n.role?.value ?? ""),
      name: String(n.name?.value ?? ""),
      focusable: n.properties?.some((p) => p.name === "focusable" && p.value.value === true) ?? false,
      props: (n.properties ?? []).map((p) => p.name),
    }));
}

const OPERABLE = new Set(["button", "link", "textbox", "combobox", "radio", "checkbox", "spinbutton", "option", "menuitem", "tab", "switch"]);
const PRODUCTS = ["apples", "bread", "milk", "eggs", "bananas"];
const status = (page: Page) => page.getByRole("status").textContent();

describe("GreenCart fixed version", () => {
  it("completes the whole task with roles, labels and the keyboard only", async () => {
    const page = await newPage();
    await page.goto(`${base}/fixed/index.html`);

    // Cookie consent is a labelled modal dialog with focus inside; the page behind is inert.
    const dialog = page.getByRole("dialog", { name: "We value your privacy" });
    await expect(dialog.count()).resolves.toBe(1);
    await expect(dialog.getAttribute("aria-modal")).resolves.toBe("true");
    await expect(page.evaluate(() => document.activeElement?.textContent?.trim())).resolves.toBe("Accept all");
    expect((await axTree(page)).some((n) => n.name === "Add apples to cart")).toBe(false);
    await page.keyboard.press("Enter");
    await expect(dialog.count()).resolves.toBe(0);
    await expect(page.evaluate(() => document.activeElement?.tagName)).resolves.toBe("H1");

    // 2 kg of apples: a named stepper, a labelled quantity, a live region that confirms.
    await page.getByRole("button", { name: "Increase apples quantity" }).click();
    await expect(page.getByLabel("Apples quantity in kg").inputValue()).resolves.toBe("2");
    await expect.poll(() => status(page)).toBe("Apples quantity: 2 kg.");
    await page.getByRole("button", { name: "Add apples to cart" }).click();
    await expect.poll(() => status(page)).toBe("Apples, 2 kg, added. Cart: 1 item.");
    await page.getByRole("button", { name: "Add bread to cart" }).click();
    await expect.poll(() => status(page)).toBe("Bread loaf, 1 loaf, added. Cart: 2 items.");

    await page.getByRole("link", { name: "Cart (2 items)" }).click();
    await page.waitForURL(/\/fixed\/cart\.html$/);
    await expect(page.getByRole("heading", { level: 1 }).textContent()).resolves.toBe("Your cart");
    await page.getByRole("link", { name: "Go to checkout" }).click();
    await page.waitForURL(/\/fixed\/checkout\.html$/);

    // Delivery is a radio group; pickup is preselected and that state is exposed.
    const group = page.getByRole("group", { name: "Delivery method" });
    await expect(group.getByRole("radio", { name: "Store pickup Free" }).isChecked()).resolves.toBe(true);
    await group.getByRole("radio", { name: "Home delivery $4.99" }).check();
    await expect(group.getByRole("radio", { name: "Home delivery $4.99" }).isChecked()).resolves.toBe(true);
    await page.getByLabel("Full name").fill("Alex Doe");
    await page.getByLabel("Address").fill("12 Elm Street");

    // Forgetting the terms gives an announced error and focus on the checkbox.
    await page.getByRole("button", { name: "Place order" }).click();
    await expect(page.getByRole("alert").textContent()).resolves.toBe("Please accept the terms of sale to place your order.");
    const terms = page.getByRole("checkbox", { name: "I accept the terms of sale and the privacy policy" });
    await expect(terms.getAttribute("aria-invalid")).resolves.toBe("true");
    await expect(terms.evaluate((el) => el === document.activeElement)).resolves.toBe(true);
    await page.keyboard.press("Space");
    await expect(terms.isChecked()).resolves.toBe(true);
    await expect(page.getByRole("alert").textContent()).resolves.toBe("");

    await page.getByRole("button", { name: "Place order" }).click();
    await page.waitForURL(/\/fixed\/done\.html$/);
    await expect(page.getByRole("heading", { level: 1 }).textContent()).resolves.toBe("Order placed");
    const body = await page.locator("main").innerText();
    for (const text of ["Apples", "2 kg", "Bread loaf", "1 loaf", "Alex Doe", "12 Elm Street", "Home delivery", "$14.19"]) {
      expect(body).toContain(text);
    }
    await page.context().close();
  }, 60_000);

  it("lets you type a quantity, and Escape closes the cookie dialog", async () => {
    const page = await newPage();
    await page.goto(`${base}/fixed/index.html`);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog").count()).resolves.toBe(0);
    await page.getByLabel("Bananas quantity in kg").fill("3");
    await page.getByRole("button", { name: "Add bananas to cart" }).click();
    await expect.poll(() => status(page)).toBe("Bananas, 3 kg, added. Cart: 1 item.");
    await page.goto(`${base}/fixed/index.html`); // consent is remembered
    await expect(page.getByRole("dialog").count()).resolves.toBe(0);
    await page.context().close();
  }, 30_000);

  it("has no nameless operable element on any page", async () => {
    const page = await newPage();
    await seed(page, "fixed", "index.html", { consent: "all", cart: { apples: 2 } });
    for (const p of ["index.html", "cart.html", "checkout.html"]) {
      await page.goto(`${base}/fixed/${p}`);
      const nameless = (await axTree(page)).filter((n) => (OPERABLE.has(n.role) || n.focusable) && n.role !== "RootWebArea" && !n.name.trim());
      expect(nameless, p).toEqual([]);
    }
    await page.context().close();
  }, 30_000);
});

describe("GreenCart bad version", () => {
  it("shows a cookie banner that is not a dialog and blocks the page silently", async () => {
    const page = await newPage();
    await page.goto(`${base}/bad/index.html`);
    await expect(page.locator("#consent").isVisible()).resolves.toBe(true);
    await expect(page.getByRole("dialog").count()).resolves.toBe(0);
    await expect(page.getByRole("button", { name: "Accept all" }).count()).resolves.toBe(0);
    const nodes = await axTree(page);
    // The only way out for a keyboard / screen reader user: one focusable element with no name.
    const unnamedFocusable = nodes.filter((n) => n.focusable && n.role === "generic" && n.name === "");
    expect(unnamedFocusable.length).toBe(1);
    expect(nodes.filter((n) => n.name === "Accept all").every((n) => !OPERABLE.has(n.role) && !n.focusable)).toBe(true);

    // While the banner is open, the product buttons do nothing, even when activated directly
    // on the element like a screen reader does (a mouse click would hit the overlay).
    const qty = page.locator(".product-card[data-product=apples] [data-qty]");
    await page.getByRole("button", { name: "+", exact: true }).first().dispatchEvent("click");
    await expect(qty.textContent()).resolves.toBe("1");

    // Enter on the unnamed element closes it.
    await page.locator(".consent-close").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#consent").isVisible()).resolves.toBe(false);
    await page.context().close();
  }, 30_000);

  it("exposes ambiguous steppers, a non-value quantity and a silent cart badge", async () => {
    const page = await newPage();
    await seed(page, "bad", "index.html", { consent: "all" });
    await expect(page.getByRole("button", { name: "−", exact: true }).count()).resolves.toBe(PRODUCTS.length);
    await expect(page.getByRole("button", { name: "+", exact: true }).count()).resolves.toBe(PRODUCTS.length);
    await expect(page.getByRole("button", { name: "Add", exact: true }).count()).resolves.toBe(PRODUCTS.length);
    await expect(page.getByRole("spinbutton").count()).resolves.toBe(0);
    await expect(page.getByRole("status").count()).resolves.toBe(0);
    await expect(page.locator("[aria-live]").count()).resolves.toBe(0);

    await page.getByRole("button", { name: "+", exact: true }).first().click();
    await expect(page.locator(".product-card[data-product=apples] [data-qty]").textContent()).resolves.toBe("2");
    await page.getByRole("button", { name: "Add", exact: true }).first().click();
    await expect(page.locator("[data-cart-badge]").textContent()).resolves.toBe("1");
    await expect(page.getByRole("link", { name: "Cart 1" }).count()).resolves.toBe(1);
    await page.context().close();
  }, 30_000);

  it("cannot be checked out with role-based interaction: the terms checkbox does not exist", async () => {
    const page = await newPage();
    await seed(page, "bad", "checkout.html", { consent: "all", cart: { apples: 2, bread: 1 } });

    // Delivery cards are buttons with no state and no tab stop.
    const home = page.getByRole("button", { name: /^Home delivery/ });
    const pickup = page.getByRole("button", { name: /^Store pickup/ });
    for (const card of [home, pickup]) {
      await expect(card.getAttribute("aria-pressed")).resolves.toBeNull();
      await expect(card.evaluate((el) => (el as HTMLElement).tabIndex)).resolves.toBe(-1);
    }
    await expect(page.getByRole("radio").count()).resolves.toBe(0);

    // BLOCKER: no checkbox, and the terms text is not operable.
    await expect(page.getByRole("checkbox").count()).resolves.toBe(0);
    await expect(page.getByLabel(/terms/i).count()).resolves.toBe(0);
    const nodes = await axTree(page);
    const termsNodes = nodes.filter((n) => /terms of sale/.test(n.name));
    expect(termsNodes.length).toBeGreaterThan(0);
    for (const n of termsNodes) expect(OPERABLE.has(n.role) || n.focusable, `${n.role} "${n.name}"`).toBe(false);
    await expect(page.locator(".checkbox").evaluate((el) => (el as HTMLElement).tabIndex)).resolves.toBe(-1);

    // Everything a screen reader user can do, then Place order: the order is refused,
    // and the error is never announced.
    await home.click();
    await page.getByLabel("Full name").fill("Alex Doe");
    await page.getByLabel("Address").fill("12 Elm Street");
    await page.getByRole("button", { name: "Place order" }).click();
    await page.waitForTimeout(300);
    expect(page.url()).toMatch(/\/bad\/checkout\.html$/);
    await expect(page.locator(".form-error").textContent()).resolves.toBe("Please accept the terms of sale to place your order.");
    await expect(page.getByRole("alert").count()).resolves.toBe(0);
    await expect(page.locator("[aria-live]").count()).resolves.toBe(0);
    await expect(page.getByLabel("Full name").evaluate((el) => el === document.activeElement)).resolves.toBe(false);
    await page.context().close();
  }, 30_000);

  it("still works for a sighted mouse user", async () => {
    const page = await newPage();
    await page.goto(`${base}/bad/index.html`);
    await page.locator(".consent-actions .btn").click();
    await page.locator(".product-card[data-product=apples] [data-step='1']").click();
    await page.locator(".product-card[data-product=apples] [data-add]").click();
    await page.locator(".product-card[data-product=bread] [data-add]").click();
    await page.locator(".cart-link").click();
    await page.locator("a.btn-primary").click();
    await page.waitForURL(/\/bad\/checkout\.html$/);
    await page.locator(".delivery-card[data-delivery=home]").click();
    await page.locator("#name").fill("Alex Doe");
    await page.locator("#address").fill("12 Elm Street");
    await page.locator(".terms").click();
    await page.locator("button[type=submit]").click();
    await page.waitForURL(/\/bad\/done\.html$/);
    await expect(page.locator("h1").textContent()).resolves.toBe("Order placed");
    await expect(page.locator("[data-field=address]").textContent()).resolves.toBe("12 Elm Street");
    await expect(page.locator("[data-field=total]").textContent()).resolves.toBe("$14.19");
    await page.context().close();
  }, 30_000);
});

describe("GreenCart visual parity", () => {
  async function shot(page: Page): Promise<Buffer> {
    await page.mouse.move(0, 0);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    return page.screenshot({ fullPage: true });
  }

  const cart = { apples: 2, bread: 1 };
  const order = { number: "GC-123456", items: [{ id: "apples", qty: 2 }, { id: "bread", qty: 1 }], name: "Alex Doe", address: "12 Elm Street", delivery: "home", total: 14.19 };
  type Prepare = (page: Page, version: "bad" | "fixed") => Promise<void>;
  const states: [string, Prepare][] = [
    ["cookie banner", async (page, v) => { await page.goto(`${base}/${v}/index.html`); }],
    ["product grid with cart", async (page, v) => {
      await seed(page, v, "index.html", { consent: "all", cart });
      await page.locator(".product-card[data-product=apples] [data-step='1']").click();
    }],
    ["cart", async (page, v) => { await seed(page, v, "cart.html", { consent: "all", cart }); }],
    ["checkout", async (page, v) => { await seed(page, v, "checkout.html", { consent: "all", cart }); }],
    ["checkout with error", async (page, v) => {
      await seed(page, v, "checkout.html", { consent: "all", cart });
      await page.locator(".delivery-card").first().click();
      await page.locator("#name").fill("Alex Doe");
      await page.locator("#address").fill("12 Elm Street");
      await page.locator("button[type=submit]").click();
    }],
    ["checkout with terms ticked", async (page, v) => {
      await seed(page, v, "checkout.html", { consent: "all", cart });
      await page.locator(".terms .checkbox").click();
    }],
    ["order placed", async (page, v) => { await seed(page, v, "done.html", { consent: "all", order }); }],
  ];

  for (const [label, prepare] of states) {
    it(`bad and fixed render identically: ${label}`, async () => {
      const page = await newPage();
      await prepare(page, "bad");
      const bad = await shot(page);
      await prepare(page, "fixed");
      const fixed = await shot(page);
      expect(bad.equals(fixed)).toBe(true);
      await page.context().close();
    }, 30_000);
  }
});
