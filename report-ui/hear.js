// "Hear this page": a header toggle that overlays, on BlindSpot's own interface, what a screen reader announces
// for each element (role and accessible name, like the transcripts in the reports: button "Run test",
// textbox "Website URL", heading level 2 "Recent runs"). A visual aid for sighted visitors, so the labels are
// aria-hidden. The role and name are an approximation computed here (explicit role or tag, then aria-label,
// aria-labelledby, <label>, alt or text content); it is not the browser's accessibility tree.

import { h } from "./dom.js";

const TARGETS = [
  "header",
  "nav",
  "main",
  "footer",
  "section[aria-labelledby]",
  "section[aria-label]",
  "form",
  "figure[aria-labelledby]",
  "figure[aria-label]",
  "h1",
  "h2",
  "h3",
  "a[href]",
  "button",
  "summary",
  "input:not([type=hidden])",
  "select",
  "textarea",
  "img",
  "[role=img]",
  "[role=group]",
  "ul[role=list]",
  "ol[role=list]",
].join(",");

const LANDMARKS = new Set(["banner", "navigation", "main", "contentinfo", "region", "form"]);
const NAME_FROM_CONTENT = new Set(["link", "button", "toggle button", "heading", "checkbox"]);
const MAX_NAME = 46;

let on = false;
let layer = null;
let observer = null;
let timer = null;

export function initHearMode() {
  const toggle = document.getElementById("hear-toggle");
  if (!toggle) return;
  toggle.addEventListener("click", () => setHearing(!on, toggle));
}

function setHearing(value, toggle) {
  on = value;
  toggle.setAttribute("aria-pressed", String(on));
  document.documentElement.classList.toggle("is-hearing", on);
  if (on) {
    layer = h("div", { class: "hear-layer", "aria-hidden": "true" });
    document.body.append(layer);
    observer = new MutationObserver((records) => {
      if (records.some((r) => !layer?.contains(r.target))) schedule();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-pressed", "hidden", "open", "aria-label"] });
    window.addEventListener("resize", schedule);
    document.addEventListener("change", schedule);
    document.addEventListener("load", schedule, true); // images changing the layout
    render();
  } else {
    observer?.disconnect();
    observer = null;
    window.removeEventListener("resize", schedule);
    document.removeEventListener("change", schedule);
    document.removeEventListener("load", schedule, true);
    clearTimeout(timer);
    layer?.remove();
    layer = null;
  }
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(render, 120);
}

function render() {
  if (!on || !layer) return;
  const items = [];
  for (const el of document.body.querySelectorAll(TARGETS)) {
    if (layer.contains(el) || el.closest('[aria-hidden="true"], [hidden], dialog:not([open]), noscript')) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 2 || rect.height <= 2) continue; // visually hidden (sr-only) or not rendered
    const top = rect.top + window.scrollY;
    if (top + rect.height < 0) continue; // parked off screen, like the skip link
    const text = announcement(el);
    if (!text) continue;
    items.push({ el, rect, top, left: rect.left + window.scrollX, ...text });
  }

  const nodes = items.map(({ role, name, state, landmark, empty }) =>
    h(
      "span",
      { class: `hear-label${landmark ? " is-landmark" : ""}${empty ? " is-empty" : ""}` },
      h("span", { class: "hear-role" }, role),
      name !== null ? [" ", h("span", { class: "hear-name" }, `"${name}"`)] : null,
      state ? [" ", h("span", { class: "hear-state" }, state)] : null,
    ),
  );
  const boxes = items.map(({ landmark }) => h("span", { class: `hear-box${landmark ? " is-landmark" : ""}` }));
  layer.replaceChildren(...boxes, ...nodes);

  // Place each label just above the top-left corner of its element (inside the corner for landmarks),
  // nudging it right, then down, when it would cover a label already placed.
  // Landmark labels go last, inside the top-right corner, sliding left out of the way of the others.
  const placed = [];
  const maxRight = document.documentElement.clientWidth - 4;
  const order = items.map((_, i) => i).sort((a, b) => Number(items[a].landmark) - Number(items[b].landmark));
  for (const i of order) {
    const item = items[i];
    Object.assign(boxes[i].style, { top: `${item.top}px`, left: `${item.left}px`, width: `${item.rect.width}px`, height: `${item.rect.height}px` });
    const label = nodes[i];
    const w = label.offsetWidth;
    const lh = label.offsetHeight;
    let x = item.landmark ? item.left + item.rect.width - w : item.left;
    let y = item.landmark ? item.top : Math.max(0, item.top - lh);
    x = Math.max(4, Math.min(x, maxRight - w));
    for (let guard = 0; guard < 40; guard++) {
      const hit = placed.find((p) => x < p.x + p.w + 3 && x + w + 3 > p.x && y < p.y + p.h && y + lh > p.y);
      if (!hit) break;
      if (item.landmark && hit.x - w - 3 >= 4) x = hit.x - w - 3;
      else if (!item.landmark && hit.x + hit.w + 3 + w <= maxRight) x = hit.x + hit.w + 3;
      else {
        x = Math.max(4, Math.min(item.landmark ? item.left + item.rect.width - w : item.left, maxRight - w));
        y = hit.y + hit.h + 1;
      }
    }
    placed.push({ x, y, w, h: lh });
    Object.assign(label.style, { top: `${y}px`, left: `${x}px` });
  }
}

/** { role, name, state, landmark, empty } as a screen reader would roughly announce the element, or null. */
export function announcement(el) {
  const role = roleOf(el);
  if (!role) return null;
  const landmark = LANDMARKS.has(role);
  let roleText = role;
  if (role === "heading") roleText = `heading level ${el.tagName.slice(1)}`;
  if (role === "list") roleText = `list (${el.children.length} ${el.children.length === 1 ? "item" : "items"})`;
  const raw = accessibleName(el, role);
  const name = clip(raw);
  // Lists and unnamed landmarks are announced by role alone.
  const showName = role === "list" ? false : landmark ? Boolean(name) : true;
  let state = "";
  if (role === "checkbox") state = el.checked ? "checked" : "not checked";
  if (role === "toggle button") state = el.getAttribute("aria-pressed") === "true" ? "pressed" : "not pressed";
  if (el.disabled || el.getAttribute("aria-disabled") === "true") state = [state, "dimmed"].filter(Boolean).join(", ");
  return { role: roleText, name: showName ? name : null, state, landmark, empty: showName && !name };
}

function roleOf(el) {
  const explicit = el.getAttribute("role");
  if (explicit === "img") return "image";
  if (explicit === "list") return el.children.length > 1 ? "list" : null;
  if (explicit === "group") return "group";
  if (explicit && explicit !== "presentation" && explicit !== "none") return explicit;
  switch (el.tagName) {
    case "A":
      return "link";
    case "BUTTON":
      return el.hasAttribute("aria-pressed") ? "toggle button" : "button";
    case "SUMMARY":
      return "button";
    case "INPUT": {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (type === "checkbox" || type === "radio") return type === "checkbox" ? "checkbox" : "radio button";
      if (type === "submit" || type === "button") return "button";
      return "textbox";
    }
    case "SELECT":
      return "combobox";
    case "TEXTAREA":
      return "textbox";
    case "IMG":
      return "image";
    case "H1":
    case "H2":
    case "H3":
      return "heading";
    case "HEADER":
      return el.closest("main, article, section, aside, nav, figure") ? null : "banner";
    case "FOOTER":
      return el.closest("main, article, section, aside, nav, figure") ? null : "contentinfo";
    case "MAIN":
      return "main";
    case "NAV":
      return "navigation";
    case "SECTION":
      return "region";
    case "FORM":
      return "form";
    case "FIGURE":
      return "figure";
    default:
      return null;
  }
}

function accessibleName(el, role) {
  const label = el.getAttribute("aria-label");
  if (label?.trim()) return label.trim();
  const by = el.getAttribute("aria-labelledby");
  if (by) {
    const text = by
      .split(/\s+/)
      .map((id) => textOf(document.getElementById(id)))
      .filter(Boolean)
      .join(" ");
    if (text) return text;
  }
  if (el.matches("input, select, textarea")) {
    const forLabel = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
    const wrap = forLabel ?? el.closest("label");
    if (wrap) return textOf(wrap);
    return el.getAttribute("title") ?? "";
  }
  if (el.tagName === "IMG") return el.getAttribute("alt") ?? "";
  if (NAME_FROM_CONTENT.has(role) || role === "heading") return textOf(el);
  return "";
}

/** Text a screen reader would read inside `node`: aria-hidden and hidden parts skipped, img alt included. */
function textOf(node) {
  if (!node) return "";
  let out = "";
  const walk = (n) => {
    if (n.nodeType === Node.TEXT_NODE) {
      out += n.textContent;
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    if (n.getAttribute("aria-hidden") === "true" || n.hidden || n.tagName === "SCRIPT" || n.tagName === "STYLE") return;
    if (n.tagName === "IMG") {
      out += ` ${n.getAttribute("alt") ?? ""} `;
      return;
    }
    if (n.tagName === "INPUT" || n.tagName === "SELECT" || n.tagName === "TEXTAREA") return;
    // Block-level children are separate chunks of text: keep a space between them.
    const block = !getComputedStyle(n).display.startsWith("inline");
    if (block) out += " ";
    n.childNodes.forEach(walk);
    if (block) out += " ";
  };
  walk(node);
  return out.replace(/\s+/g, " ").trim();
}

function clip(text) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  return t.length > MAX_NAME ? `${t.slice(0, MAX_NAME - 1).trimEnd()}…` : t;
}
