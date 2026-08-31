// Shared palette DOM builder: the search box + "Relationships" section +
// per-layer element sections, used by both the real VS Code sidebar
// (paletteMain.ts, arms tools by posting to the extension host) and the
// standalone dev-preview harness's embedded dock (designer.ts, arms tools
// by calling straight into the same ArchimateDesigner instance). Only the
// DOM/filtering is shared here — how a click/drag on a button actually arms
// a tool is genuinely different between the two contexts (a separate,
// isolated sidebar webview can't drag-and-drop onto the canvas), so callers
// wire their own listeners onto the returned button maps.

import { ElementType, RelationshipType, LAYERS } from './model.js';
import { elementIcon, relationshipIcon } from './icons.js';
import { PALETTE_GROUPS, RELATIONSHIP_LIST, humanize } from './paletteData.js';
import { el } from './domUtil.js';

export interface PaletteDom {
  searchInput: HTMLInputElement;
  scroll: HTMLDivElement;
  elementButtons: Map<ElementType, HTMLButtonElement>;
  relButtons: Map<RelationshipType, HTMLButtonElement>;
}

export function buildPaletteDom(): PaletteDom {
  const searchInput = el('input', 'am-palette-search');
  searchInput.placeholder = 'Filter…';

  const scroll = el('div', 'am-palette-scroll');
  const elementButtons = new Map<ElementType, HTMLButtonElement>();
  const relButtons = new Map<RelationshipType, HTMLButtonElement>();

  // Relationships first, mirroring how connector tools lead an ArchiMate palette.
  const relSection = el('div', 'am-palette-section');
  const relHeader = el('div', 'am-palette-header am-palette-header-rel');
  relHeader.textContent = 'Relationships';
  relHeader.addEventListener('click', () => relSection.classList.toggle('am-collapsed'));
  relSection.appendChild(relHeader);
  const relGrid = el('div', 'am-icon-grid');
  for (const type of RELATIONSHIP_LIST) {
    const btn = el('button', 'am-icon-btn am-icon-btn-rel', { title: humanize(type), type: 'button' });
    btn.dataset.kind = 'relationship';
    btn.dataset.type = type;
    btn.appendChild(relationshipIcon(type));
    relButtons.set(type, btn);
    relGrid.appendChild(btn);
  }
  relSection.appendChild(relGrid);
  scroll.appendChild(relSection);

  for (const group of PALETTE_GROUPS) {
    const layer = LAYERS[group.layer];
    const section = el('div', 'am-palette-section');
    const header = el('div', 'am-palette-header');
    header.style.setProperty('--am-layer-color', layer.color);
    header.style.setProperty('--am-layer-stroke', layer.stroke);
    header.textContent = layer.label;
    header.addEventListener('click', () => section.classList.toggle('am-collapsed'));
    section.appendChild(header);
    const grid = el('div', 'am-icon-grid');
    for (const type of group.types) {
      const btn = el('button', 'am-icon-btn', { title: humanize(type), type: 'button' });
      btn.dataset.kind = 'element';
      btn.dataset.type = type;
      btn.style.setProperty('--am-layer-stroke', layer.stroke);
      btn.appendChild(elementIcon(type));
      elementButtons.set(type, btn);
      grid.appendChild(btn);
    }
    section.appendChild(grid);
    scroll.appendChild(section);
  }

  // Filters both elements and relationships (an embedded-only gap in the
  // pre-extraction code left relationship buttons unfiltered — fixed here
  // by filtering every `.am-icon-btn` uniformly, matching the sidebar's
  // original, broader behavior).
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    const items = scroll.querySelectorAll<HTMLElement>('.am-icon-btn');
    for (const item of items) item.style.display = !q || item.title.toLowerCase().includes(q) ? '' : 'none';
    for (const section of scroll.querySelectorAll<HTMLElement>('.am-palette-section')) {
      const sectionItems = section.querySelectorAll<HTMLElement>('.am-icon-btn');
      const visible = [...sectionItems].some((i) => i.style.display !== 'none');
      section.style.display = !q || visible ? '' : 'none';
      if (q && visible) section.classList.remove('am-collapsed');
    }
  });

  return { searchInput, scroll, elementButtons, relButtons };
}
