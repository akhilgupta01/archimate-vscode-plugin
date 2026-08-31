// Entry point for the ArchiMate Palette sidebar view (a separate
// WebviewView, registered by extension.ts in its own Activity Bar
// container) — bundled to dist/palette.js. Lets the palette live alongside
// the Explorer and Copilot Chat instead of eating space inside the main
// designer's canvas.
//
// VS Code webviews are isolated contexts, so native drag-and-drop from here
// onto the designer's canvas (a different webview) isn't possible. Instead,
// clicking a tool "arms" it (posted to the extension host, which relays it
// to the designer panel); the designer places the element (or starts a
// relationship draw) on the next canvas click, then echoes the cleared
// state back so this view's highlight stays in sync. See
// ArchimateDesigner's `hostApi` option and `_armTool` in designer.ts.

import { ElementType, RelationshipType, LAYERS } from './model.js';
import { elementIcon, relationshipIcon } from './icons.js';
import { PALETTE_GROUPS, RELATIONSHIP_LIST, humanize } from './paletteData.js';

interface VsCodeApi { postMessage(message: unknown): void; }
declare function acquireVsCodeApi(): VsCodeApi;
const vscode = acquireVsCodeApi();

const root = document.getElementById('app');
if (!root) throw new Error('#app root not found');
root.classList.add('am-palette');

const search = document.createElement('input');
search.className = 'am-palette-search';
search.placeholder = 'Filter…';
root.appendChild(search);

const scroll = document.createElement('div');
scroll.className = 'am-palette-scroll';
root.appendChild(scroll);

let armedKind: 'element' | 'relationship' | null = null;
let armedType: string | null = null;

function clearActive(): void {
  scroll.querySelectorAll('.am-icon-btn.am-active').forEach((b) => b.classList.remove('am-active'));
}

function arm(kind: 'element' | 'relationship', type: string, btn: HTMLElement): void {
  const already = armedKind === kind && armedType === type;
  clearActive();
  if (already) {
    armedKind = null;
    armedType = null;
  } else {
    armedKind = kind;
    armedType = type;
    btn.classList.add('am-active');
  }
  vscode.postMessage({ type: 'archiToolArm', kind, archiType: type });
}

// Relationships first, mirroring the embedded palette's layout.
const relSection = document.createElement('div');
relSection.className = 'am-palette-section';
const relHeader = document.createElement('div');
relHeader.className = 'am-palette-header am-palette-header-rel';
relHeader.textContent = 'Relationships';
relHeader.addEventListener('click', () => relSection.classList.toggle('am-collapsed'));
relSection.appendChild(relHeader);
const relGrid = document.createElement('div');
relGrid.className = 'am-icon-grid';
for (const type of RELATIONSHIP_LIST) {
  const btn = document.createElement('button');
  btn.className = 'am-icon-btn am-icon-btn-rel';
  btn.type = 'button';
  btn.title = humanize(type);
  btn.dataset.kind = 'relationship';
  btn.dataset.type = type;
  btn.appendChild(relationshipIcon(type));
  btn.addEventListener('click', () => arm('relationship', type as RelationshipType, btn));
  relGrid.appendChild(btn);
}
relSection.appendChild(relGrid);
scroll.appendChild(relSection);

for (const group of PALETTE_GROUPS) {
  const layer = LAYERS[group.layer];
  const section = document.createElement('div');
  section.className = 'am-palette-section';
  const header = document.createElement('div');
  header.className = 'am-palette-header';
  header.style.setProperty('--am-layer-color', layer.color);
  header.style.setProperty('--am-layer-stroke', layer.stroke);
  header.textContent = layer.label;
  header.addEventListener('click', () => section.classList.toggle('am-collapsed'));
  section.appendChild(header);
  const grid = document.createElement('div');
  grid.className = 'am-icon-grid';
  for (const type of group.types) {
    const btn = document.createElement('button');
    btn.className = 'am-icon-btn';
    btn.type = 'button';
    btn.title = humanize(type);
    btn.dataset.kind = 'element';
    btn.dataset.type = type;
    btn.style.setProperty('--am-layer-stroke', layer.stroke);
    btn.appendChild(elementIcon(type));
    btn.addEventListener('click', () => arm('element', type as ElementType, btn));
    grid.appendChild(btn);
  }
  section.appendChild(grid);
  scroll.appendChild(section);
}

search.addEventListener('input', () => {
  const q = search.value.trim().toLowerCase();
  const items = scroll.querySelectorAll<HTMLElement>('.am-icon-btn');
  for (const item of items) item.style.display = !q || item.title.toLowerCase().includes(q) ? '' : 'none';
  for (const section of scroll.querySelectorAll<HTMLElement>('.am-palette-section')) {
    const sectionItems = section.querySelectorAll<HTMLElement>('.am-icon-btn');
    const visible = [...sectionItems].some((i) => i.style.display !== 'none');
    section.style.display = !q || visible ? '' : 'none';
    if (q && visible) section.classList.remove('am-collapsed');
  }
});

// The designer echoes its armed/cleared state back (after placing an
// element, completing/cancelling a relationship draw, or Esc) so our
// highlight never drifts out of sync with what's actually armed over there.
window.addEventListener('message', (event: MessageEvent) => {
  const d = event.data;
  if (!d || d.type !== 'archiToolArmedChanged') return;
  armedKind = d.kind ?? null;
  armedType = d.archiType ?? null;
  clearActive();
  if (armedKind && armedType) {
    const btn = scroll.querySelector<HTMLElement>(`.am-icon-btn[data-kind="${armedKind}"][data-type="${armedType}"]`);
    btn?.classList.add('am-active');
  }
});
