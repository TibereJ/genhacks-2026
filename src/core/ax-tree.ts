// Turns Chromium's accessibility tree (CDP Accessibility.getFullAXTree) into a plain-text
// transcript of what a screen reader user would perceive, with numbered ids on the elements
// they can operate. The agent only ever sees this transcript.

/** Minimal subset of CDP's Accessibility.AXNode that we use. */
export interface AXNode {
  nodeId: string;
  ignored: boolean;
  role?: { value?: unknown };
  name?: { value?: unknown };
  value?: { value?: unknown };
  properties?: { name: string; value: { value?: unknown } }[];
  childIds?: string[];
  backendDOMNodeId?: number;
}

export interface SnapshotElement {
  id: number;
  backendNodeId: number;
  role: string;
  name: string;
  value?: string;
  /** For comboboxes and listboxes: option labels. */
  options?: string[];
}

export interface Snapshot {
  url: string;
  title: string;
  /** The transcript shown to the agent. */
  text: string;
  /** Operable elements by transcript id. */
  elements: Map<number, SnapshotElement>;
  /** Description of the focused element, e.g. `button "Book"`, if any. */
  focused?: string;
  /** Texts of alert/status/live regions currently on the page. */
  liveTexts: string[];
  /** Flat list of non-ignored nodes (role + name), used by the automated scan. */
  flat: { role: string; name: string; backendNodeId?: number; level?: number }[];
}

const INTERACTIVE = new Set([
  "button", "link", "textbox", "searchbox", "combobox", "listbox", "option", "checkbox", "radio",
  "switch", "slider", "spinbutton", "menuitem", "menuitemcheckbox", "menuitemradio", "tab",
  "treeitem", "MenuListOption", "PopUpButton", "ToggleButton", "textField", "DisclosureTriangle",
  "Date", "DateTime", "InputTime",
]);

const LANDMARKS = new Set([
  "banner", "navigation", "main", "contentinfo", "complementary", "form", "region", "search",
  "dialog", "alertdialog",
]);

const LIVE = new Set(["alert", "status", "log", "marquee", "timer"]);

/** Roles whose children are only their name: print the node and don't descend. */
const LEAF_LIKE = new Set(["heading", "image", "img", "StaticText", "LineBreak"]);

/** Wrapper roles that add nothing for a screen reader user: descend without printing. */
const TRANSPARENT = new Set([
  "generic", "none", "presentation", "paragraph", "Section", "LayoutTable", "LayoutTableRow",
  "LayoutTableCell", "group", "list", "listitem", "RootWebArea", "WebArea", "Iframe",
  "IframePresentational", "InlineTextBox", "Canvas", "Pre", "Abbr", "time", "strong",
  "emphasis", "Figcaption", "figure", "article", "blockquote", "Legend", "LabelText", "label",
  "ListMarker", "MenuListPopup", "Ruby", "superscript", "subscript", "mark", "code", "term",
  "definition", "DescriptionList", "DescriptionListTerm", "DescriptionListDetail", "insertion",
  "deletion", "table", "row", "cell", "rowgroup", "columnheader", "rowheader", "gridcell",
]);

const MAX_LINES = 500;

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function prop(node: AXNode, name: string): unknown {
  return node.properties?.find((p) => p.name === name)?.value.value;
}

function quote(s: string): string {
  return JSON.stringify(s.replace(/\s+/g, " ").trim());
}

/** Human role names, closer to what screen readers say. */
function spokenRole(role: string): string {
  switch (role) {
    case "img": case "image": return "image";
    case "MenuListOption": return "option";
    case "PopUpButton": return "button menu";
    case "ToggleButton": return "toggle button";
    case "textField": return "textbox";
    case "Date": return "date field";
    case "DateTime": return "date and time field";
    case "InputTime": return "time field";
    default: return role;
  }
}

function states(node: AXNode, role: string): string[] {
  const out: string[] = [];
  const checked = prop(node, "checked");
  if (role === "checkbox" || role === "radio" || role === "switch" || role === "menuitemcheckbox" || role === "menuitemradio") {
    out.push(checked === "true" || checked === true ? "checked" : checked === "mixed" ? "partially checked" : "not checked");
  }
  const pressed = prop(node, "pressed");
  if (pressed === "true" || pressed === true) out.push("pressed");
  const expanded = prop(node, "expanded");
  if (expanded !== undefined) out.push(expanded === true || expanded === "true" ? "expanded" : "collapsed");
  if (prop(node, "selected") === true && role !== "MenuListOption" && role !== "option") out.push("selected");
  if (prop(node, "required") === true) out.push("required");
  const invalid = prop(node, "invalid");
  if (invalid !== undefined && invalid !== "false" && invalid !== false) out.push("invalid entry");
  if (prop(node, "disabled") === true) out.push("unavailable");
  if (prop(node, "readonly") === true) out.push("read only");
  return out;
}

export function buildSnapshot(nodes: AXNode[], url: string, title: string): Snapshot {
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const childIds = new Set(nodes.flatMap((n) => n.childIds ?? []));
  const root = nodes.find((n) => !childIds.has(n.nodeId)) ?? nodes[0];

  const lines: string[] = [];
  const elements = new Map<number, SnapshotElement>();
  const flat: Snapshot["flat"] = [];
  const liveTexts: string[] = [];
  let focused: string | undefined;
  let nextId = 1;
  let truncated = 0;

  const emit = (depth: number, line: string) => {
    if (lines.length >= MAX_LINES) { truncated++; return; }
    lines.push("  ".repeat(depth) + line);
  };

  const collectText = (node: AXNode): string => {
    const parts: string[] = [];
    const walk = (n: AXNode) => {
      if (str(n.role?.value) === "StaticText" && !n.ignored) parts.push(str(n.name?.value));
      for (const c of n.childIds ?? []) { const cn = byId.get(c); if (cn) walk(cn); }
    };
    walk(node);
    return parts.join(" ").replace(/\s+/g, " ").trim();
  };

  const collectOptions = (node: AXNode): string[] => {
    const out: string[] = [];
    const walk = (n: AXNode) => {
      const r = str(n.role?.value);
      if (!n.ignored && (r === "option" || r === "MenuListOption")) out.push(str(n.name?.value));
      for (const c of n.childIds ?? []) { const cn = byId.get(c); if (cn) walk(cn); }
    };
    for (const c of node.childIds ?? []) { const cn = byId.get(c); if (cn) walk(cn); }
    return out;
  };

  const visit = (node: AXNode, depth: number) => {
    const role = str(node.role?.value);
    const name = str(node.name?.value).replace(/\s+/g, " ").trim();
    const descend = (d: number) => {
      for (const c of node.childIds ?? []) { const cn = byId.get(c); if (cn) visit(cn, d); }
    };

    if (node.ignored) { descend(depth); return; }

    const level = typeof prop(node, "level") === "number" ? (prop(node, "level") as number) : undefined;
    flat.push({ role, name, backendNodeId: node.backendDOMNodeId, level });

    const focusable = prop(node, "focusable") === true;
    const isFocused = prop(node, "focused") === true && role !== "RootWebArea";
    // Options of a native <select> are listed on the combobox line itself.
    if (role === "MenuListOption" || role === "MenuListPopup") return;

    if (INTERACTIVE.has(role) || (focusable && TRANSPARENT.has(role) && role !== "RootWebArea")) {
      const id = nextId++;
      const value = str(node.value?.value);
      const shownRole = INTERACTIVE.has(role) ? spokenRole(role) : `${role} (focusable)`;
      let line = `[${id}] ${shownRole} ${quote(name)}`;
      const el: SnapshotElement = { id, backendNodeId: node.backendDOMNodeId ?? -1, role: spokenRole(role), name };
      if (value && role !== "link" && role !== "button") { line += ` value ${quote(value)}`; el.value = value; }
      if (role === "combobox" || role === "listbox") {
        const options = collectOptions(node);
        if (options.length) { el.options = options; line += ` options: ${options.map(quote).join(", ")}`; }
      }
      const st = states(node, role);
      if (st.length) line += ` (${st.join(", ")})`;
      if (isFocused) { line += " ← focus"; focused = `${spokenRole(role)} ${quote(name)}`; }
      if (node.backendDOMNodeId !== undefined) elements.set(id, el);
      emit(depth, line);
      // Links and buttons announce their content as their name; other widgets may contain more.
      if (role === "listbox" || role === "radiogroup") descend(depth + 1);
      return;
    }

    if (role === "heading") {
      emit(depth, `heading level ${level ?? "?"} ${quote(name || collectText(node))}`);
      return;
    }
    if (role === "img" || role === "image") {
      emit(depth, name ? `image ${quote(name)}` : "image (no description)");
      return;
    }
    if (role === "StaticText") {
      if (name) emit(depth, `text ${quote(name)}`);
      return;
    }
    if (LEAF_LIKE.has(role)) return;

    if (LIVE.has(role)) {
      const text = name || collectText(node);
      if (text) liveTexts.push(text);
      emit(depth, `${role} ${quote(text)}`);
      return;
    }
    if (LANDMARKS.has(role) || role === "radiogroup") {
      emit(depth, name ? `${role} ${quote(name)}` : role);
      descend(depth + 1);
      return;
    }
    if (role === "group" && name) {
      emit(depth, `group ${quote(name)}`);
      descend(depth + 1);
      return;
    }
    descend(depth);
  };

  if (root) visit(root, 0);
  if (truncated) lines.push(`… (${truncated} more lines not shown)`);

  const header = `Page: ${title || "(untitled page)"}`;
  return { url, title, text: [header, ...lines].join("\n"), elements, focused, liveTexts, flat };
}
