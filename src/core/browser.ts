import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from "playwright";
import { buildSnapshot, type AXNode, type Snapshot, type SnapshotElement } from "./ax-tree.js";

export type BrowserAction =
  | { type: "click"; id: number }
  | { type: "type"; id: number; text: string }
  | { type: "select"; id: number; option: string }
  | { type: "press"; key: string }
  | { type: "back" };

export interface ActionOutcome {
  ok: boolean;
  /** What a screen reader user would notice after the action. */
  result: string;
  /** The snapshot after the action. */
  snapshot: Snapshot;
}

/**
 * Full Chromium in headless mode is closer to real Chrome than Playwright's lighter headless shell (and uses
 * the system certificate store on Linux). Fall back to the default build if it isn't installed.
 * Override with BLINDSPOT_BROWSER_CHANNEL (e.g. "chrome", "msedge", or "default" for the headless shell).
 */
async function launchBrowser(): Promise<Browser> {
  const channel = process.env.BLINDSPOT_BROWSER_CHANNEL || "chromium";
  if (channel === "default") return chromium.launch();
  try {
    return await chromium.launch({ channel });
  } catch {
    return chromium.launch();
  }
}

export type RequestGuard = (url: URL) => Promise<string | null>;

const ALLOWED_KEYS = new Set(["Enter", "Escape", "Tab", "Shift+Tab", "Space", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"]);

/**
 * One Chromium tab driven only through what the accessibility tree exposes.
 *
 * Tabs: when an action opens a new tab (target="_blank", window.open), the session switches to it, as a screen
 * reader would, and says so in the result. The previous tab stays open: "back" in a tab that has no history of its
 * own closes it and returns to the previous tab.
 */
export class BrowserSession {
  /** Tabs we left for a new one, most recent last. */
  private readonly previousTabs: Page[] = [];
  /** Pages opened since the current action started. */
  private openedPages: Page[] = [];

  private constructor(
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    private currentPage: Page,
    private cdp: CDPSession,
  ) {
    context.on("page", (p) => this.openedPages.push(p));
  }

  /** The tab the agent is currently on. */
  get page(): Page {
    return this.currentPage;
  }

  private static async attach(context: BrowserContext, page: Page): Promise<CDPSession> {
    const cdp = await context.newCDPSession(page);
    await cdp.send("DOM.enable");
    await cdp.send("Accessibility.enable");
    return cdp;
  }

  /**
   * @param requestGuard Called for every request the page makes (navigations, redirects, assets).
   *   Return a reason to block it, or null to allow it. Used by public instances against SSRF.
   */
  static async open(url: string, requestGuard?: RequestGuard): Promise<BrowserSession> {
    const browser = await launchBrowser();
    // Service workers would serve requests without going through context.route (and the request guard).
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
    if (requestGuard) {
      const verdicts = new Map<string, Promise<string | null>>();
      await context.route("**/*", async (route) => {
        const target = new URL(route.request().url());
        if (target.protocol === "data:" || target.protocol === "blob:") return route.continue();
        const key = `${target.protocol}//${target.host}${target.pathname.startsWith("/demo/") ? "/demo/" : ""}`;
        if (!verdicts.has(key)) verdicts.set(key, requestGuard(target).catch(() => "guard error"));
        const reason = await verdicts.get(key)!;
        if (reason) return route.abort("blockedbyclient");
        // The browser follows redirects without calling this route again, so walk the redirect
        // chain here, checking every hop, then send the browser straight to the final URL.
        try {
          let response = await route.fetch({ maxRedirects: 0 });
          let current = target;
          for (let hop = 0; response.status() >= 300 && response.status() < 400; hop++) {
            const location = response.headers()["location"];
            if (!location || hop >= 5) break;
            const next = new URL(location, current);
            const why = await requestGuard(next).catch(() => "guard error");
            if (why) return route.abort("blockedbyclient");
            current = next;
            response = await route.fetch({ url: next.href, maxRedirects: 0 });
          }
          if (current.href !== target.href) {
            return route.fulfill({ status: 302, headers: { location: current.href } });
          }
          return route.fulfill({ response });
        } catch {
          return route.abort("failed");
        }
      });
    }
    const page = await context.newPage();
    const cdp = await BrowserSession.attach(context, page);
    const session = new BrowserSession(browser, context, page, cdp);
    try {
      // Real sites often never fire "load" in time (trackers, long polling): wait for the DOM, then settle.
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await session.settle();
    } catch (err) {
      await browser.close().catch(() => {});
      throw err;
    }
    return session;
  }

  async close(): Promise<void> {
    await this.browser.close();
  }

  async snapshot(): Promise<Snapshot> {
    try {
      return await this.readSnapshot();
    } catch {
      // A navigation in progress (redirect, script, late form submit) destroys the document mid-read
      // ("Execution context was destroyed"): wait for the new page and try once more.
      await this.currentPage.waitForLoadState("load", { timeout: 15_000 }).catch(() => {});
      return this.readSnapshot();
    }
  }

  private async readSnapshot(): Promise<Snapshot> {
    // getDocument resets backend node bookkeeping so DOM.resolveNode works after navigations.
    await this.cdp.send("DOM.getDocument", { depth: 0 });
    const { nodes } = (await this.cdp.send("Accessibility.getFullAXTree")) as unknown as { nodes: AXNode[] };
    return buildSnapshot(nodes, this.currentPage.url(), await this.currentPage.title());
  }

  /** Makes `page` the current tab. */
  private async switchTo(page: Page): Promise<void> {
    const cdp = await BrowserSession.attach(this.context, page);
    await this.cdp.detach().catch(() => {});
    this.cdp = cdp;
    this.currentPage = page;
    await page.bringToFront().catch(() => {});
  }

  /** If the last action opened a tab, switch to it. Returns true when it did. */
  private async adoptNewTab(): Promise<boolean> {
    const opened = this.openedPages.filter((p) => !p.isClosed());
    this.openedPages = [];
    const next = opened.at(-1);
    if (!next) return false;
    await next.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
    if (next.isClosed()) return false;
    this.previousTabs.push(this.currentPage);
    await this.switchTo(next);
    await this.settle();
    return true;
  }

  /** Screenshot for human readers of the report, with the target element outlined. */
  async screenshot(path: string, highlight?: SnapshotElement): Promise<void> {
    let objectId: string | undefined;
    if (highlight) {
      objectId = await this.resolve(highlight).catch(() => undefined);
      if (objectId) {
        await this.call(objectId, `function () {
          this.scrollIntoView({ block: "center", inline: "nearest" });
          this.dataset.bsOutline = this.style.outline;
          this.style.outline = "4px solid #e11d48";
          this.style.outlineOffset = "3px";
        }`).catch(() => {});
      }
    }
    await this.currentPage.screenshot({ path, fullPage: false });
    if (objectId) {
      await this.call(objectId, `function () {
        this.style.outline = this.dataset.bsOutline || "";
        this.style.outlineOffset = "";
        delete this.dataset.bsOutline;
      }`).catch(() => {});
    }
  }

  async act(action: BrowserAction, before: Snapshot): Promise<ActionOutcome> {
    const fail = async (result: string): Promise<ActionOutcome> => ({ ok: false, result, snapshot: await this.snapshot() });
    this.openedPages = [];
    let tab: TabChange | undefined;

    let el: SnapshotElement | undefined;
    if ("id" in action) {
      el = before.elements.get(action.id);
      if (!el) return fail(`There is no element [${action.id}] on this page. Use an id from the latest transcript.`);
    }

    try {
      switch (action.type) {
        case "click": {
          const objectId = await this.resolve(el!);
          // Screen readers activate the element itself (default action), not screen coordinates.
          await this.call(objectId, `function () { this.scrollIntoView({ block: "center" }); if (this.focus) this.focus(); this.click(); }`);
          break;
        }
        case "type": {
          if (!["textbox", "searchbox", "combobox", "spinbutton", "date field", "time field", "date and time field"].includes(el!.role)) {
            return fail(`${el!.role} "${el!.name}" is not a text field, so you cannot type into it.`);
          }
          const objectId = await this.resolve(el!);
          await this.call(objectId, `function () {
            this.scrollIntoView({ block: "center" });
            this.focus();
            if (this.type === "date" || this.type === "time" || this.type === "datetime-local" || this.type === "month") {
              this.dataset.bsDateInput = this.type;
            } else if (typeof this.select === "function") { this.select(); }
            else if (this.isContentEditable) { document.getSelection().selectAllChildren(this); }
          }`);
          const dateType = (await this.call(objectId, `function () { return this.dataset.bsDateInput || ""; }`)) as string;
          if (dateType) {
            // Date/time inputs take keyboard entry in locale order; set the value directly, as typing a full date would.
            const value = normalizeDateValue(dateType, action.text);
            if (!value) return fail(`Could not understand "${action.text}" for this ${dateType} field. Use ${DATE_FORMATS[dateType] ?? "YYYY-MM-DD"}.`);
            await this.call(objectId, `function (v) {
              delete this.dataset.bsDateInput;
              this.value = v;
              this.dispatchEvent(new Event("input", { bubbles: true }));
              this.dispatchEvent(new Event("change", { bubbles: true }));
            }`, [value]);
          } else {
            await this.currentPage.keyboard.type(action.text, { delay: 5 });
          }
          break;
        }
        case "select": {
          const objectId = await this.resolve(el!);
          const chosen = await this.call(objectId, `function (wanted) {
            const w = wanted.trim().toLowerCase();
            if (this.tagName !== "SELECT") return { error: "not-select" };
            const opts = Array.from(this.options);
            const match = opts.find(o => o.text.trim().toLowerCase() === w) || opts.find(o => o.text.toLowerCase().includes(w));
            if (!match) return { error: "no-match", options: opts.map(o => o.text.trim()) };
            this.focus();
            this.value = match.value;
            this.dispatchEvent(new Event("input", { bubbles: true }));
            this.dispatchEvent(new Event("change", { bubbles: true }));
            return { ok: match.text.trim() };
          }`, [action.option]) as { ok?: string; error?: string; options?: string[] };
          if (chosen.error === "not-select") return fail(`${el!.role} "${el!.name}" is not a list you can choose from. Try click instead.`);
          if (chosen.error === "no-match") return fail(`No option matches "${action.option}". Options are: ${chosen.options!.map((o) => `"${o}"`).join(", ")}.`);
          break;
        }
        case "press": {
          if (!ALLOWED_KEYS.has(action.key)) return fail(`Key "${action.key}" is not supported. Use one of: ${[...ALLOWED_KEYS].join(", ")}.`);
          await this.currentPage.keyboard.press(action.key === "Space" ? " " : action.key);
          break;
        }
        case "back": {
          const { currentIndex } = await this.cdp.send("Page.getNavigationHistory");
          const previous = this.previousTabs.at(-1);
          if (currentIndex === 0 && previous && !previous.isClosed()) {
            // Nothing to go back to in this tab: close it and return to the tab that opened it.
            const closing = this.currentPage;
            this.previousTabs.pop();
            await this.switchTo(previous);
            await closing.close().catch(() => {});
            tab = "closed";
          } else {
            await this.currentPage.goBack({ waitUntil: "domcontentloaded", timeout: 15_000 });
          }
          break;
        }
      }
    } catch (err) {
      return fail(`The action failed: ${(err as Error).message.split("\n")[0]}`);
    }

    await this.settle();
    if (await this.adoptNewTab()) tab = "opened";
    const after = await this.snapshot();
    return { ok: true, result: describeChange(before, after, action, el, tab), snapshot: after };
  }

  /** Wait for navigation and scripts triggered by an action to finish. */
  private async settle(): Promise<void> {
    await this.currentPage.waitForTimeout(350);
    await this.currentPage.waitForLoadState("load", { timeout: 15_000 }).catch(() => {});
    await this.currentPage.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => {});
  }

  private async resolve(el: SnapshotElement): Promise<string> {
    const { object } = await this.cdp.send("DOM.resolveNode", { backendNodeId: el.backendNodeId });
    if (!object.objectId) throw new Error("element is no longer on the page");
    return object.objectId;
  }

  private async call(objectId: string, fn: string, args: unknown[] = []): Promise<unknown> {
    const res = await this.cdp.send("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: fn,
      arguments: args.map((value) => ({ value })),
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text);
    return res.result.value;
  }
}

const DATE_FORMATS: Record<string, string> = { date: "YYYY-MM-DD", time: "HH:MM (24h)", "datetime-local": "YYYY-MM-DDTHH:MM", month: "YYYY-MM" };

/** Turns what the agent typed into the value an <input type="date|time|datetime-local|month"> takes. */
export function normalizeDateValue(type: string, input: string): string | undefined {
  const s = input.trim();
  if (type === "time") {
    const m = /^(\d{1,2})[:h.](\d{2})\s*(am|pm)?$/i.exec(s);
    if (!m) return undefined;
    let h = Number(m[1]);
    if (m[3]?.toLowerCase() === "pm" && h < 12) h += 12;
    if (m[3]?.toLowerCase() === "am" && h === 12) h = 0;
    return h < 24 ? `${String(h).padStart(2, "0")}:${m[2]}` : undefined;
  }
  if (type === "month") return /^\d{4}-\d{2}$/.test(s) ? s : undefined;
  if (type === "datetime-local") return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s) ? s : undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Free-form dates ("December 15, 2026") parse as local midnight: read them back in local time,
  // since toISOString() would shift the day east of UTC.
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return undefined;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export type TabChange = "opened" | "closed";

/** Summarise what a screen reader user would notice after an action. */
export function describeChange(before: Snapshot, after: Snapshot, action: BrowserAction, el?: SnapshotElement, tab?: TabChange): string {
  const parts: string[] = [];
  const title = `"${after.title || "(untitled page)"}"`;
  if (tab === "opened") parts.push(`A new tab opened: ${title}.`);
  else if (tab === "closed") parts.push(`This tab closed. Back on the previous tab: ${title}.`);
  else if (after.url !== before.url || after.title !== before.title) parts.push(`New page loaded: ${title}.`);
  const newLive = after.liveTexts.filter((t) => !before.liveTexts.includes(t));
  for (const t of newLive) parts.push(`Announced: "${t}".`);
  if (action.type === "type" || action.type === "select") {
    const same = [...after.elements.values()].find((e) => e.role === el?.role && e.name === el?.name);
    if (same) parts.push(`${same.role} "${same.name}" now has value "${same.value ?? ""}".`);
  }
  if (action.type === "click" && el && el.states !== undefined) {
    const same = [...after.elements.values()].find((e) => e.role === el.role && e.name === el.name);
    if (same?.states && same.states.join() !== el.states.join()) parts.push(`${same.role} "${same.name}" is now ${same.states.join(", ")}.`);
  }
  if (after.focused && after.focused !== before.focused) parts.push(`Focus moved to ${after.focused}.`);
  if (parts.length === 0) {
    parts.push(after.text === before.text
      ? "Nothing was announced and the page content did not change."
      : "Nothing was announced, but the page content changed.");
  }
  return parts.join(" ");
}
