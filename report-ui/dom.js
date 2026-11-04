// Tiny DOM builder. Report strings come from arbitrary websites and from the AI, so they are
// only ever inserted as text nodes, never parsed as HTML.

/**
 * h("p", { class: "x", onclick: fn }, "text", childNode, [more, children])
 * - attributes starting with "on" become event listeners
 * - `false`, `null` and `undefined` attributes/children are skipped
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  setAttrs(el, attrs);
  append(el, children);
  return el;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** Same as h() for SVG elements. */
export function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  setAttrs(el, attrs);
  append(el, children);
  return el;
}

function setAttrs(el, attrs) {
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === false || value === null || value === undefined) continue;
    if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2), value);
    } else if (key === "dataset") {
      Object.assign(el.dataset, value);
    } else {
      el.setAttribute(key, value === true ? "" : String(value));
    }
  }
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** Replace all children of `el`. */
export function replaceChildren(el, ...children) {
  el.replaceChildren();
  append(el, children);
}

/** Small inline icons (static markup, built as SVG nodes). */
const ICONS = {
  speaker: ["M11 5 6 9H2v6h4l5 4V5z", "M15.5 8.5a5 5 0 0 1 0 7", "M19 5a10 10 0 0 1 0 14"],
  stop: ["M7 7h10v10H7z"],
  check: ["M20 6 9 17l-5-5"],
  cross: ["M18 6 6 18", "M6 6l12 12"],
  alert: ["M12 9v4", "M12 17h.01", "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"],
  eye: ["M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z", "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"],
  ear: ["M6 8.5a6 6 0 1 1 12 0c0 6-6 6-6 10a3 3 0 0 1-6 0", "M10 8.5a2 2 0 1 1 4 0"],
  expand: ["M15 3h6v6", "M9 21H3v-6", "M21 3l-7 7", "M3 21l7-7"],
  copy: ["M9 9h11v11H9z", "M5 15H4V4h11v1"],
  image: ["M3 5h18v14H3z", "M3 16l5-5 4 4 3-3 6 6", "M15.5 9.5h.01"],
  arrow: ["M5 12h14", "M13 6l6 6-6 6"],
  back: ["M19 12H5", "M11 18l-6-6 6-6"],
  download: ["M12 4v11", "M7 10l5 5 5-5", "M5 20h14"],
  compare: ["M4 7h13", "M13 3l4 4-4 4", "M20 17H7", "M11 13l-4 4 4 4"],
  plus: ["M12 5v14", "M5 12h14"],
  minus: ["M5 12h14"],
  power: ["M12 3v8", "M6.3 6.8a8 8 0 1 0 11.4 0"],
};

export function icon(name, extraClass = "") {
  return s(
    "svg",
    {
      class: `icon ${extraClass}`.trim(),
      viewBox: "0 0 24 24",
      width: 20,
      height: 20,
      fill: "none",
      stroke: "currentColor",
      "stroke-width": 2,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
      focusable: "false",
    },
    (ICONS[name] ?? []).map((d) => s("path", { d })),
  );
}
