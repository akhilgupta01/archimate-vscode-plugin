// Shared inspector form builder: title + Name/Label field + (element only)
// Documentation field and Appearance section, or (relationship only) an
// "Auto-route again" button. Used by both the real VS Code sidebar
// (inspectorMain.ts, posts edits to the extension host) and the standalone
// dev-preview harness's embedded dock (designer.ts, mutates the model
// directly) — both funnel edits through the same `final` flag (live
// keystroke vs. committed change) so a single callback shape covers both.

import { el } from "./domUtil.js";
import { humanize } from "./paletteData.js";

export const APPEARANCE_FIELDS = [
  "fillColor",
  "fillOpacity",
  "lineColor",
  "lineOpacity",
  "lineWidth",
  "lineStyle",
  "fontColor",
  "fontFamily",
  "fontSize",
  "textAlign",
  "verticalAlign",
] as const;
export type AppearanceField = (typeof APPEARANCE_FIELDS)[number];
const APPEARANCE_FIELD_SET: ReadonlySet<string> = new Set(APPEARANCE_FIELDS);
export function isAppearanceField(field: string): field is AppearanceField {
  return APPEARANCE_FIELD_SET.has(field);
}

export interface ElementAppearance {
  fillColor: string | null;
  fillOpacity: number | null;
  lineColor: string | null;
  lineOpacity: number | null;
  lineWidth: "thin" | "normal" | "thick" | null;
  lineStyle: "solid" | "dashed" | "dotted" | null;
  fontColor: string | null;
  fontFamily: string | null;
  fontSize: number | null;
  textAlign: "left" | "center" | "right" | null;
  verticalAlign: "top" | "middle" | "bottom" | null;
  /** Layer defaults, shown as the swatch/placeholder when there's no override. */
  defaultFillColor: string;
  defaultLineColor: string;
}

export type Selection =
  | ({
      kind: "element";
      id: string;
      type: string;
      name: string;
      documentation: string;
    } & ElementAppearance)
  | { kind: "relationship"; id: string; type: string; name: string }
  | null;

export const INSPECTOR_EMPTY_HTML =
  '<div class="am-inspector-empty">Select an element or relationship to edit its properties.</div>';

export interface InspectorCallbacks {
  onEdit(
    id: string,
    field: "name" | "documentation" | AppearanceField,
    value: string,
    final: boolean,
  ): void;
  onReroute(id: string): void;
  onResetAppearance(id: string): void;
}

const INSPECTOR_TABS = ["Main", "Appearance"] as const;
type InspectorTab = (typeof INSPECTOR_TABS)[number];
const FONT_FAMILIES = [
  "Inherit",
  "Arial",
  "Georgia",
  "Tahoma",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana",
];

function createInspectorTabs(
  onSelect: (tab: InspectorTab) => void,
  activeTab: InspectorTab,
): HTMLElement {
  const nav = el("nav", "am-inspector-nav");
  for (const tabText of INSPECTOR_TABS) {
    const tab = el("button", "am-inspector-tab");
    tab.type = "button";
    tab.textContent = tabText;
    tab.setAttribute("aria-pressed", String(tabText === activeTab));
    if (tabText === activeTab) tab.classList.add("is-active");
    tab.addEventListener("click", () => {
      if (tabText !== "Main" && tabText !== "Appearance") return;
      onSelect(tabText);
    });
    nav.appendChild(tab);
  }
  return nav;
}

// One field per row, reusing the exact same label|control grid the Main
// tab's Name/Documentation rows already use — a VS Code sidebar is rarely
// wider than ~300px, too narrow to fit two labeled fields per row (that
// squeezed every control down to ~26px, unreadable), so this trades row
// count for something that's actually legible at the width it will really
// be shown at.
function fieldRow(container: HTMLElement, label: string, control: HTMLElement): void {
  const row = el("div", "am-form-row");
  const rowLabel = el("label", "am-field-label");
  rowLabel.textContent = label;
  row.append(rowLabel, control);
  container.appendChild(row);
}

// Packs a color swatch next to its opacity spinner (or any other small
// related controls) on one row, instead of giving the opacity value its
// own full label row — keeps the closely-related pair visually paired
// without the row-per-field layout ballooning to 10 rows.
function controlGroup(...controls: HTMLElement[]): HTMLElement {
  const group = el("div", "am-control-group");
  group.append(...controls);
  return group;
}

function colorControl(
  value: string | null,
  fallback: string,
  onChange: (v: string) => void,
): HTMLInputElement {
  const swatch = el("input", "am-color-swatch") as HTMLInputElement;
  swatch.type = "color";
  swatch.value = value || fallback;
  swatch.addEventListener("input", () => onChange(swatch.value));
  return swatch;
}

function numberControl(
  value: number | null,
  onChange: (v: string) => void,
): HTMLInputElement {
  const input = el("input", "am-field-input") as HTMLInputElement;
  input.type = "number";
  input.min = "0";
  input.max = "255";
  input.value = String(value ?? 255);
  input.addEventListener("change", () => onChange(input.value));
  return input;
}

function selectControl(
  options: [string, string][],
  value: string | null,
  defaultValue: string,
  onChange: (v: string) => void,
): HTMLSelectElement {
  const select = el("select", "am-field-input") as HTMLSelectElement;
  for (const [val, text] of options) {
    const opt = document.createElement("option");
    opt.value = val;
    opt.textContent = text;
    select.appendChild(opt);
  }
  select.value = value || defaultValue;
  select.addEventListener("change", () => onChange(select.value));
  return select;
}

function renderAppearanceSection(
  root: HTMLElement,
  sel: Selection & { kind: "element" },
  cb: InspectorCallbacks,
): void {
  const header = el("div", "am-inspector-section-header");
  header.textContent = "Appearance";
  root.appendChild(header);

  const form = el("div", "am-appearance-form");

  fieldRow(form, "Fill Colour", controlGroup(
    colorControl(sel.fillColor, sel.defaultFillColor, (v) => cb.onEdit(sel.id, "fillColor", v, true)),
    numberControl(sel.fillOpacity, (v) => cb.onEdit(sel.id, "fillOpacity", v, true)),
  ));
  fieldRow(form, "Line Colour", controlGroup(
    colorControl(sel.lineColor, sel.defaultLineColor, (v) => cb.onEdit(sel.id, "lineColor", v, true)),
    numberControl(sel.lineOpacity, (v) => cb.onEdit(sel.id, "lineOpacity", v, true)),
  ));
  fieldRow(form, "Line Width", selectControl(
    [["thin", "Thin"], ["normal", "Normal"], ["thick", "Thick"]],
    sel.lineWidth, "normal", (v) => cb.onEdit(sel.id, "lineWidth", v, true),
  ));
  fieldRow(form, "Line Style", selectControl(
    [["solid", "Solid"], ["dashed", "Dashed"], ["dotted", "Dotted"]],
    sel.lineStyle, "solid", (v) => cb.onEdit(sel.id, "lineStyle", v, true),
  ));
  fieldRow(form, "Font Colour", colorControl(sel.fontColor, "#222222", (v) => cb.onEdit(sel.id, "fontColor", v, true)));
  fieldRow(form, "Font", selectControl(
    FONT_FAMILIES.map((f) => [f === "Inherit" ? "" : f, f]),
    sel.fontFamily, "", (v) => cb.onEdit(sel.id, "fontFamily", v, true),
  ));
  const fontSizeInput = el("input", "am-field-input") as HTMLInputElement;
  fontSizeInput.type = "number";
  fontSizeInput.min = "6";
  fontSizeInput.max = "72";
  fontSizeInput.value = String(sel.fontSize ?? 12);
  fontSizeInput.addEventListener("change", () => cb.onEdit(sel.id, "fontSize", fontSizeInput.value, true));
  fieldRow(form, "Font Size", fontSizeInput);
  fieldRow(form, "Text Align", selectControl(
    [["left", "Left"], ["center", "Center"], ["right", "Right"]],
    sel.textAlign, "center", (v) => cb.onEdit(sel.id, "textAlign", v, true),
  ));
  fieldRow(form, "Vertical Align", selectControl(
    [["top", "Top"], ["middle", "Middle"], ["bottom", "Bottom"]],
    sel.verticalAlign, "middle", (v) => cb.onEdit(sel.id, "verticalAlign", v, true),
  ));

  const resetBtn = el("button", "am-btn");
  resetBtn.type = "button";
  resetBtn.textContent = "Reset to Default";
  resetBtn.title = "Clear every Appearance override and fall back to the layer defaults";
  resetBtn.addEventListener("click", () => cb.onResetAppearance(sel.id));
  form.appendChild(resetBtn);

  root.appendChild(form);
}

// Persisted across calls (not per-call state) so re-rendering the *same*
// selection — e.g. after Reset to Default changes several fields at once —
// keeps whatever tab the user was looking at, while actually picking a
// different element/relationship still starts back on Main.
let lastSelectionId: string | null = null;
let lastActiveTab: InspectorTab = "Main";

export function renderInspectorDom(
  root: HTMLElement,
  selection: Selection,
  cb: InspectorCallbacks,
): void {
  root.innerHTML = "";
  if (!selection) {
    root.innerHTML = INSPECTOR_EMPTY_HTML;
    lastSelectionId = null;
    return;
  }
  if (selection.id !== lastSelectionId) {
    lastActiveTab = "Main";
    lastSelectionId = selection.id;
  }

  const panel = el("div", "am-inspector-panel");
  const sidebar = el("div", "am-inspector-sidebar");

  const main = el("div", "am-inspector-main");
  const header = el("div", "am-inspector-header");
  const title = el("div", "am-inspector-title");
  const titleText = humanize(selection.type);
  title.textContent = `${titleText} (${titleText})`;
  header.appendChild(title);

  const form = el("div", "am-inspector-form");

  const renderTabContent = (activeTab: InspectorTab): void => {
    form.innerHTML = "";

    if (activeTab === "Main") {
      const propertiesHeader = el("div", "am-inspector-section-header");
      propertiesHeader.textContent = "Main";
      form.appendChild(propertiesHeader);

      const nameRow = el("div", "am-form-row");
      const nameLabel = el("label", "am-field-label");
      nameLabel.textContent =
        selection.kind === "relationship" ? "Label" : "Name";
      const nameInput = el("input", "am-field-input");
      nameInput.placeholder =
        selection.kind === "relationship" ? "Unlabeled" : "Unnamed";
      nameInput.value = selection.name;
      nameInput.addEventListener("input", () =>
        cb.onEdit(selection.id, "name", nameInput.value, false),
      );
      nameInput.addEventListener("change", () =>
        cb.onEdit(selection.id, "name", nameInput.value, true),
      );
      nameRow.append(nameLabel, nameInput);
      form.appendChild(nameRow);

      if (selection.kind === "element") {
        const docRow = el("div", "am-form-row");
        const docLabel = el("label", "am-field-label");
        docLabel.textContent = "Documentation";
        const docInput = el("textarea", "am-field-textarea");
        docInput.placeholder = "Add documentation…";
        docInput.value = selection.documentation;
        docInput.addEventListener("change", () =>
          cb.onEdit(selection.id, "documentation", docInput.value, true),
        );
        docRow.append(docLabel, docInput);
        form.appendChild(docRow);
      }
    } else if (activeTab === "Appearance" && selection.kind === "element") {
      renderAppearanceSection(form, selection, cb);
    } else if (selection.kind !== "element") {
      const rerouteBtn = el("button", "am-btn");
      rerouteBtn.textContent = "Auto-route again";
      rerouteBtn.title =
        "Clear manual bend/hinge points and let the router pick again";
      rerouteBtn.addEventListener("click", () => cb.onReroute(selection.id));
      form.appendChild(rerouteBtn);
    }
  };

  let activeTab: InspectorTab = lastActiveTab;
  const updateTabs = () => {
    sidebar.innerHTML = "";
    sidebar.appendChild(
      createInspectorTabs((tab) => {
        activeTab = tab;
        lastActiveTab = tab;
        updateTabs();
        renderTabContent(activeTab);
      }, activeTab),
    );
  };

  updateTabs();
  renderTabContent(activeTab);

  main.append(header, form);
  panel.append(sidebar, main);
  root.appendChild(panel);
}
