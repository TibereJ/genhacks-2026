import { chromium, type Browser, type CDPSession, type Page } from "playwright";
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

const ALLOWED_KEYS = new Set(["Enter", "Escape", "Tab", "Shift+Tab", "Space", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"]);

/** One Chromium tab driven only through what the accessibility tree exposes. */
export class BrowserSession {
  private constructor(
    private readonly browser: Browser,
    readonly page: Page,
    private readonly cdp: CDPSession,
  ) {}

  static async open(url: string): Promise<BrowserSession> {
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("DOM.enable");
    await cdp.send("Accessibility.enable");
    const session = new BrowserSession(browser, page, cdp);
    await page.goto(url, { waitUntil: "load", timeout: 30_000 });
    await session.settle();
    return session;
  }

  async close(): Promise<void> {
    await this.browser.close();
  }

  async snapshot(): Promise<Snapshot> {
    // getDocument resets backend node bookkeeping so DOM.resolveNode works after navigations.
    await this.cdp.send("DOM.getDocument", { depth: 0 });
    const { nodes } = (await this.cdp.send("Accessibility.getFullAXTree")) as unknown as { nodes: AXNode[] };
    return buildSnapshot(nodes, this.page.url(), await this.page.title());
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
    await this.page.screenshot({ path, fullPage: false });
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
          if (!["textbox", "searchbox", "combobox", "spinbutton"].includes(el!.role)) {
            return fail(`${el!.role} "${el!.name}" is not a text field, so you cannot type into it.`);
          }
          const objectId = await this.resolve(el!);
          await this.call(objectId, `function () {
            this.scrollIntoView({ block: "center" });
            this.focus();
            if (this.type === "date" || this.type === "time" || this.type === "datetime-local" || this.type === "month") {
              this.dataset.bsDateInput = "1";
            } else if (typeof this.select === "function") { this.select(); }
            else if (this.isContentEditable) { document.getSelection().selectAllChildren(this); }
          }`);
          const isDate = await this.call(objectId, `function () { return this.dataset.bsDateInput === "1"; }`);
          if (isDate) {
            // Date inputs take keyboard entry in locale order; set the value directly as a screen reader's edit field would.
            const value = normalizeDate(action.text);
            if (!value) return fail(`Could not understand "${action.text}" as a date. Use the format YYYY-MM-DD.`);
            await this.call(objectId, `function (v) {
              delete this.dataset.bsDateInput;
              this.value = v;
              this.dispatchEvent(new Event("input", { bubbles: true }));
              this.dispatchEvent(new Event("change", { bubbles: true }));
            }`, [value]);
          } else {
            await this.page.keyboard.type(action.text, { delay: 5 });
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
          await this.page.keyboard.press(action.key === "Space" ? " " : action.key);
          break;
        }
        case "back": {
          await this.page.goBack({ waitUntil: "load", timeout: 15_000 });
          break;
        }
      }
    } catch (err) {
      return fail(`The action failed: ${(err as Error).message.split("\n")[0]}`);
    }

    await this.settle();
    const after = await this.snapshot();
    return { ok: true, result: describeChange(before, after, action, el), snapshot: after };
  }

  /** Wait for navigation and scripts triggered by an action to finish. */
  private async settle(): Promise<void> {
    await this.page.waitForTimeout(350);
    await this.page.waitForLoadState("load", { timeout: 15_000 }).catch(() => {});
    await this.page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => {});
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

function normalizeDate(input: string): string | undefined {
  const s = input.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString().slice(0, 10);
}

/** Summarise what a screen reader user would notice after an action. */
export function describeChange(before: Snapshot, after: Snapshot, action: BrowserAction, el?: SnapshotElement): string {
  const parts: string[] = [];
  if (after.url !== before.url || after.title !== before.title) {
    parts.push(`New page loaded: "${after.title || "(untitled page)"}".`);
  }
  const newLive = after.liveTexts.filter((t) => !before.liveTexts.includes(t));
  for (const t of newLive) parts.push(`Announced: "${t}".`);
  if (action.type === "type" || action.type === "select") {
    const same = [...after.elements.values()].find((e) => e.role === el?.role && e.name === el?.name);
    if (same) parts.push(`${same.role} "${same.name}" now has value "${same.value ?? ""}".`);
  }
  if (after.focused && after.focused !== before.focused) parts.push(`Focus moved to ${after.focused}.`);
  if (parts.length === 0) {
    parts.push(after.text === before.text
      ? "Nothing was announced and the page content did not change."
      : "Nothing was announced, but the page content changed.");
  }
  return parts.join(" ");
}
