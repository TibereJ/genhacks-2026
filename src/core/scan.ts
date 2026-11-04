import type { Page } from "playwright";
import type { Snapshot } from "./ax-tree.js";
import type { Issue } from "./types.js";

export type ScanFinding = Omit<Issue, "id" | "stepIndex" | "source" | "blocking">;

interface DomFinding {
  kind: "img-no-alt" | "clickable-not-operable" | "placeholder-only" | "no-lang";
  html: string;
  text: string;
}

const NAMELESS_ROLES: Record<string, { title: string; wcag: string[]; fix: string }> = {
  button: {
    title: "Button has no accessible name",
    wcag: ["4.1.2 Name, Role, Value"],
    fix: 'Give the button visible text, or an aria-label when it only contains an icon:\n<button aria-label="Close"><svg aria-hidden="true">…</svg></button>',
  },
  link: {
    title: "Link has no accessible name",
    wcag: ["2.4.4 Link Purpose (In Context)", "4.1.2 Name, Role, Value"],
    fix: 'Add text to the link, or an aria-label for icon-only links:\n<a href="/book" aria-label="Book an appointment"><svg aria-hidden="true">…</svg></a>',
  },
  textbox: {
    title: "Text field has no label",
    wcag: ["1.3.1 Info and Relationships", "3.3.2 Labels or Instructions", "4.1.2 Name, Role, Value"],
    fix: 'Associate a visible label with the field:\n<label for="email">Email</label>\n<input id="email" type="email" autocomplete="email">',
  },
  combobox: {
    title: "Drop-down list has no label",
    wcag: ["1.3.1 Info and Relationships", "3.3.2 Labels or Instructions", "4.1.2 Name, Role, Value"],
    fix: 'Associate a label with the select element:\n<label for="doctor">Doctor</label>\n<select id="doctor">…</select>',
  },
  checkbox: {
    title: "Checkbox has no label",
    wcag: ["1.3.1 Info and Relationships", "4.1.2 Name, Role, Value"],
    fix: '<input type="checkbox" id="terms"> <label for="terms">I accept the terms</label>',
  },
  radio: {
    title: "Radio button has no label",
    wcag: ["1.3.1 Info and Relationships", "4.1.2 Name, Role, Value"],
    fix: '<input type="radio" id="t900" name="time" value="09:00"> <label for="t900">9:00</label>',
  },
};

/**
 * Deterministic checks run once per page. They catch the classic, rule-based problems so the
 * agent can focus on whether the task itself is doable.
 */
export async function scanPage(page: Page, snapshot: Snapshot): Promise<ScanFinding[]> {
  const findings: ScanFinding[] = [];
  const pageLabel = snapshot.title || snapshot.url;

  // 1. Operable elements without a name (from the accessibility tree, like a screen reader).
  const nameless = new Map<string, number>();
  for (const n of snapshot.flat) {
    const role = n.role === "searchbox" ? "textbox" : n.role;
    if (NAMELESS_ROLES[role] && !n.name) nameless.set(role, (nameless.get(role) ?? 0) + 1);
  }
  for (const [role, count] of nameless) {
    const rule = NAMELESS_ROLES[role];
    findings.push({
      severity: "serious",
      title: rule.title,
      description: `${count} ${role}${count > 1 ? "s" : ""} on "${pageLabel}" ${count > 1 ? "are" : "is"} announced only as "${role}", with no name. A screen reader user cannot tell what ${count > 1 ? "they do" : "it does"}.`,
      wcag: rule.wcag,
      fix: rule.fix,
      element: { role, name: "" },
    });
  }

  // 2. Heading levels that skip (e.g. h1 → h4).
  const levels = snapshot.flat.filter((n) => n.role === "heading" && n.level).map((n) => ({ level: n.level!, name: n.name }));
  for (let i = 1; i < levels.length; i++) {
    if (levels[i].level > levels[i - 1].level + 1) {
      findings.push({
        severity: "minor",
        title: "Heading levels skip",
        description: `The heading "${levels[i].name}" is level ${levels[i].level} but follows a level ${levels[i - 1].level} heading. Screen reader users navigate by headings and may think content is missing.`,
        wcag: ["1.3.1 Info and Relationships"],
        fix: `Use heading levels in order. Change it to <h${levels[i - 1].level + 1}> and style it with CSS if it should look smaller.`,
        element: { role: "heading", name: levels[i].name },
      });
      break;
    }
  }

  if (!snapshot.title) {
    findings.push({
      severity: "moderate",
      title: "Page has no title",
      description: "The page has no <title>, so screen readers announce nothing useful when it loads.",
      wcag: ["2.4.2 Page Titled"],
      fix: "<title>Book an appointment – Your Site</title>",
    });
  }

  // 3. DOM checks the accessibility tree alone cannot show.
  // Passed as a string: tsx/esbuild can inject helpers (e.g. __name) into functions, which do not exist in the page.
  const dom = (await page.evaluate(DOM_CHECKS)) as DomFinding[];

  const imgs = dom.filter((d) => d.kind === "img-no-alt");
  if (imgs.length) {
    findings.push({
      severity: "serious",
      title: "Images have no text alternative",
      description: `${imgs.length} image${imgs.length > 1 ? "s" : ""} on "${pageLabel}" ${imgs.length > 1 ? "have" : "has"} no alt attribute. Screen readers announce them as "image" or read the file name.`,
      wcag: ["1.1.1 Non-text Content"],
      fix: 'Describe meaningful images, and mark decorative ones as empty:\n<img src="logo.svg" alt="Maple Grove Clinic">\n<img src="divider.png" alt="">',
      element: { role: "image", name: "", html: imgs[0].html },
    });
  }

  const clickables = dom.filter((d) => d.kind === "clickable-not-operable");
  if (clickables.length) {
    const sample = clickables.slice(0, 4).map((c) => `"${c.text}"`).join(", ");
    findings.push({
      severity: "critical",
      title: "Clickable elements cannot be reached or activated with a screen reader or keyboard",
      description: `${clickables.length} element${clickables.length > 1 ? "s" : ""} on "${pageLabel}" react to mouse clicks but are not buttons, links or form controls (for example ${sample}). Screen readers announce them as plain text and keyboard users cannot focus them.`,
      wcag: ["2.1.1 Keyboard", "4.1.2 Name, Role, Value"],
      fix: 'Use a native control instead of a clickable <div>. For a choice between options, a radio group:\n<fieldset>\n  <legend>Available times</legend>\n  <input type="radio" id="t1" name="time" value="09:00"><label for="t1">9:00</label>\n</fieldset>\nFor an action: <button type="button">…</button>',
      element: { role: "generic", name: clickables[0].text, html: clickables[0].html },
    });
  }

  const placeholders = dom.filter((d) => d.kind === "placeholder-only");
  if (placeholders.length) {
    findings.push({
      severity: "moderate",
      title: "Fields use a placeholder instead of a label",
      description: `${placeholders.length} field${placeholders.length > 1 ? "s" : ""} on "${pageLabel}" only have placeholder text (${placeholders.map((p) => `"${p.text}"`).join(", ")}). It disappears while typing and is not reliably announced by every screen reader.`,
      wcag: ["3.3.2 Labels or Instructions", "1.3.1 Info and Relationships"],
      fix: `Keep the placeholder as a hint if you like, but add a real label:\n<label for="name">Full name</label>\n<input id="name" autocomplete="name">`,
      element: { role: "textbox", name: placeholders[0].text, html: placeholders[0].html },
    });
  }

  if (dom.some((d) => d.kind === "no-lang")) {
    findings.push({
      severity: "minor",
      title: "Page language is not set",
      description: "The <html> element has no lang attribute, so screen readers may read the page with the wrong voice and pronunciation.",
      wcag: ["3.1.1 Language of Page"],
      fix: '<html lang="en">',
    });
  }

  return findings;
}

/** Runs in the page. Plain JavaScript on purpose (see scanPage). */
const DOM_CHECKS = `(() => {
  const out = [];
  const snippet = (el) => {
    const clone = el.cloneNode(true);
    clone.querySelectorAll("svg").forEach((s) => s.replaceChildren());
    return clone.outerHTML.replace(/\\s+/g, " ").slice(0, 160);
  };
  const hidden = (el) => el.closest('[aria-hidden="true"], [hidden]') !== null || getComputedStyle(el).display === "none" || getComputedStyle(el).visibility === "hidden";

  if (!document.documentElement.getAttribute("lang")) out.push({ kind: "no-lang", html: "<html>", text: "" });

  document.querySelectorAll("img:not([alt])").forEach((img) => {
    if (!hidden(img) && !img.getAttribute("aria-label") && !img.getAttribute("aria-labelledby") && img.getAttribute("role") !== "presentation") {
      out.push({ kind: "img-no-alt", html: snippet(img), text: img.getAttribute("src") || "" });
    }
  });

  const NATIVE = "a[href], button, input, select, textarea, summary, label, option, [contenteditable='true']";
  const ROLES = new Set(["button", "link", "checkbox", "radio", "tab", "menuitem", "option", "switch", "combobox", "slider", "textbox"]);
  const seen = new Set();
  document.querySelectorAll("body *").forEach((el) => {
    if (hidden(el) || el.matches(NATIVE) || el.closest(NATIVE)) return;
    const role = el.getAttribute("role");
    if (role && ROLES.has(role) && el.hasAttribute("tabindex")) return;
    const clickable = el.hasAttribute("onclick") || (getComputedStyle(el).cursor === "pointer" && getComputedStyle(el.parentElement).cursor !== "pointer");
    if (!clickable) return;
    for (const s of seen) if (s.contains(el)) return;
    seen.add(el);
    out.push({ kind: "clickable-not-operable", html: snippet(el), text: (el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 60) });
  });

  document.querySelectorAll("input:not([type=hidden]):not([type=submit]):not([type=button]), textarea").forEach((input) => {
    const hasLabel = (input.labels && input.labels.length > 0) || input.getAttribute("aria-label") || input.getAttribute("aria-labelledby") || input.getAttribute("title");
    if (!hasLabel && input.placeholder && !hidden(input)) out.push({ kind: "placeholder-only", html: snippet(input), text: input.placeholder });
  });
  return out;
})()`;
