import { chromium, type Browser, type BrowserContext, type CDPSession, type LaunchOptions, type Page } from "playwright";
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
 * the system certificate store on Linux). Falls back to the default build only when full Chromium isn't installed
 * ("Executable doesn't exist"), saying so on stderr; any other failure is thrown.
 * Override with BLINDSPOT_BROWSER_CHANNEL (e.g. "chrome", "msedge", or "default" for the headless shell): a channel
 * chosen there never falls back.
 */
export async function launchBrowser(
  launch: (options?: LaunchOptions) => Promise<Browser> = (options) => chromium.launch(options),
  env: NodeJS.ProcessEnv = process.env,
): Promise<Browser> {
  const explicit = env.BLINDSPOT_BROWSER_CHANNEL?.trim();
  const channel = explicit || "chromium";
  if (channel === "default") return launch();
  try {
    return await launch({ channel });
  } catch (err) {
    const first = (err as Error).message ?? String(err);
    if (explicit) {
      throw new Error(`Could not start the browser channel "${channel}" set in BLINDSPOT_BROWSER_CHANNEL: ${first}`, { cause: err });
    }
    if (!/Executable doesn't exist/i.test(first)) throw err;
    console.error(`BlindSpot: full Chromium is not installed (${first.split("\n")[0]}). Falling back to Playwright's default headless browser.`);
    try {
      return await launch();
    } catch (second) {
      throw new Error(
        `Could not start a browser.\nFull Chromium: ${first}\nDefault build: ${(second as Error).message ?? String(second)}`,
        { cause: second },
      );
    }
  }
}

export type RequestGuard = (url: URL) => Promise<string | null>;

const ALLOWED_KEYS = new Set(["Enter", "Escape", "Tab", "Shift+Tab", "Space", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"]);

/**
 * One Chromium tab driven only through what the accessibility tree exposes.
 *
 * Tabs: when an action opens a new tab (target="_blank", window.open), the session switches to it, as a screen
 * reader would, and says so in the result. The previous tab stays open: "back" in a tab that has no history of its
 * own closes it and returns to the previous tab. A tab opened later (by a timer, after the action settled) is picked
 * up at the next action or snapshot, and a tab that closes itself (a popup) sends the session back to the previous
 * one. When several tabs open at once, the one opened by the current tab wins; tabs that stay on about:blank are
 * ignored until they load something.
 */
export class BrowserSession {
  /** Tabs we left for a new one, most recent last. */
  private readonly previousTabs: Page[] = [];
  /** Pages opened since we last looked (the listener stays on for the whole session). */
  private openedPages: Page[] = [];
  /** New tabs still on about:blank: adopted later if they navigate somewhere. */
  private blankPages: Page[] = [];

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
    return (await this.observe()).snapshot;
  }

  /** Switches tabs if needed (see syncTabs), then reads the transcript. */
  private async observe(): Promise<{ snapshot: Snapshot; tab?: TabChange }> {
    let tab = await this.syncTabs();
    try {
      return { snapshot: await this.readSnapshot(), tab };
    } catch {
      // A navigation in progress (redirect, script, late form submit) destroys the document mid-read
      // ("Execution context was destroyed"): wait for the new page and try once more. The tab may also
      // have closed itself in the meantime.
      await this.currentPage.waitForLoadState("load", { timeout: 15_000 }).catch(() => {});
      tab = (await this.syncTabs()) ?? tab;
      return { snapshot: await this.readSnapshot(), tab };
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

  /**
   * Puts the session on the tab a screen reader user would be on now: a tab opened since we last looked (preferring
   * one opened by the current tab, ignoring tabs that stay on about:blank), or, if the current tab closed itself,
   * the previous tab. Returns what changed.
   */
  private async syncTabs(): Promise<TabChange | undefined> {
    const next = await this.pickNewTab();
    if (next) {
      if (!this.currentPage.isClosed()) this.previousTabs.push(this.currentPage);
      await this.switchTo(next);
      await this.settle();
      return "opened";
    }
    if (!this.currentPage.isClosed()) return undefined;
    let previous: Page | undefined;
    while ((previous = this.previousTabs.pop()) && previous.isClosed());
    previous ??= this.context.pages().filter((p) => !p.isClosed()).at(-1);
    if (!previous) throw new Error("Every tab of the browser was closed.");
    await this.switchTo(previous);
    await this.settle();
    return "closed";
  }

  private async pickNewTab(): Promise<Page | undefined> {
    const candidates = [...this.blankPages, ...this.openedPages].filter((p, i, all) => !p.isClosed() && all.indexOf(p) === i && p !== this.currentPage);
    this.openedPages = [];
    this.blankPages = [];
    if (!candidates.length) return undefined;
    await Promise.all(candidates.map((p) => p.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {})));
    const loaded: Page[] = [];
    for (const p of candidates) {
      if (p.isClosed()) continue;
      if (p.url() === "about:blank" || p.url() === "") this.blankPages.push(p);
      else loaded.push(p);
    }
    if (!loaded.length) return undefined;
    const current = this.currentPage.isClosed() ? undefined : this.currentPage;
    const openers = await Promise.all(loaded.map((p) => p.opener().catch(() => null)));
    const fromCurrent = loaded.filter((_, i) => current && openers[i] === current);
    return (fromCurrent.length ? fromCurrent : loaded).at(-1);
  }

  /** Screenshot for human readers of the report, with the target element outlined. */
  async screenshot(path: string, highlight?: SnapshotElement): Promise<void> {
    if (this.currentPage.isClosed()) return; // the tab closed itself: act() reports it
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
    try {
      await this.currentPage.screenshot({ path, fullPage: false });
    } catch (err) {
      if (!this.currentPage.isClosed()) throw err;
      return;
    }
    if (objectId) {
      await this.call(objectId, `function () {
        this.style.outline = this.dataset.bsOutline || "";
        this.style.outlineOffset = "";
        delete this.dataset.bsOutline;
      }`).catch(() => {});
    }
  }

  async act(action: BrowserAction, before: Snapshot): Promise<ActionOutcome> {
    const fail = async (result: string): Promise<ActionOutcome> => {
      const { snapshot, tab } = await this.observe();
      return { ok: false, result: tab ? `${result} ${describeChange(before, snapshot, action, undefined, tab)}` : result, snapshot };
    };
    if (this.currentPage.isClosed()) return fail("The tab you were on closed by itself, so the action was not performed.");
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
      // An action that makes the tab close itself (a popup's "Done" button) can fail half-way: that is not an error.
      if (!this.currentPage.isClosed()) return fail(`The action failed: ${(err as Error).message.split("\n")[0]}`);
    }

    await this.settle();
    const { snapshot: after, tab: changed } = await this.observe();
    return { ok: true, result: describeChange(before, after, action, el, changed ?? tab), snapshot: after };
  }

  /** Wait for navigation and scripts triggered by an action to finish. */
  private async settle(): Promise<void> {
    if (this.currentPage.isClosed()) return;
    await this.currentPage.waitForTimeout(350).catch(() => {});
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
