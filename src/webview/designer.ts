import { ArchimateModel, ArchimateElement, ArchimateRelationship, ELEMENT_TYPES, RELATIONSHIP_TYPES, LAYERS, ElementType, RelationshipType, LayerKey, ModelJSON } from './model.js';
import { Renderer } from './renderer.js';
import { elementIcon, relationshipIcon } from './icons.js';
import { snappedPerimeterPoint } from './router.js';
import { computeMoveSnap, computeResizedBox, enforceMinSize, computeResizeSnap, ResizeHandle } from './snap.js';
import { LocalStorageAdapter } from './storage/LocalStorageAdapter.js';
import type { StorageAdapter, TreeEntry, ViewData } from './storage/StorageAdapter.js';

const GRID_SIZE = 10;
const GUIDE_SNAP_PX = 6; // screen pixels; converted to world units by dividing by zoom

const PALETTE_GROUPS: { layer: LayerKey; types: ElementType[] }[] = [
  { layer: 'strategy', types: ['Resource', 'Capability', 'CourseOfAction', 'ValueStream'] },
  { layer: 'business', types: ['BusinessActor', 'BusinessRole', 'BusinessCollaboration', 'BusinessInterface', 'BusinessProcess', 'BusinessFunction', 'BusinessInteraction', 'BusinessEvent', 'BusinessService', 'BusinessObject', 'Contract', 'Representation', 'Product'] },
  { layer: 'application', types: ['ApplicationComponent', 'ApplicationCollaboration', 'ApplicationInterface', 'ApplicationFunction', 'ApplicationInteraction', 'ApplicationProcess', 'ApplicationEvent', 'ApplicationService', 'DataObject'] },
  { layer: 'technology', types: ['Node', 'Device', 'SystemSoftware', 'TechnologyCollaboration', 'TechnologyInterface', 'Path', 'CommunicationNetwork', 'TechnologyFunction', 'TechnologyProcess', 'TechnologyInteraction', 'TechnologyEvent', 'TechnologyService', 'Artifact', 'Equipment', 'Facility', 'DistributionNetwork', 'Material'] },
  { layer: 'motivation', types: ['Stakeholder', 'Driver', 'Assessment', 'Goal', 'Outcome', 'Principle', 'Requirement', 'Constraint', 'Meaning', 'Value'] },
  { layer: 'implementation', types: ['WorkPackage', 'Deliverable', 'ImplementationEvent', 'Plateau', 'Gap'] },
  { layer: 'other', types: ['Grouping', 'Location', 'Junction'] },
];
const RELATIONSHIP_LIST = Object.keys(RELATIONSHIP_TYPES) as RelationshipType[];

function humanize(type: string): string { return type.replace(/([a-z])([A-Z])/g, '$1 $2'); }
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}
function fmtTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString();
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function svgTag(tag: string, attrs: Record<string, string | number> = {}): SVGElement {
  const e = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  return e;
}
function folderGlyph(open: boolean): SVGElement {
  const svg = svgTag('svg', { viewBox: '0 0 14 14', class: 'am-tree-icon' });
  const common = { fill: '#dcb35c', stroke: '#a3792f', 'stroke-width': 1, 'stroke-linejoin': 'round' };
  if (open) {
    svg.appendChild(svgTag('path', { d: 'M1,4 L1,11.5 L12.5,11.5 L13.5,5.5 L4,5.5 L3,4 Z', ...common }));
    svg.appendChild(svgTag('path', { d: 'M1,4 L5,4 L6,2.5 L11.5,2.5 L11.5,5.5', fill: 'none', stroke: '#a3792f', 'stroke-width': 1 }));
  } else {
    svg.appendChild(svgTag('path', { d: 'M1,3.5 L5.5,3.5 L6.5,5 L13,5 L13,11.5 L1,11.5 Z', ...common }));
  }
  return svg;
}
function fileGlyph(): SVGElement {
  const svg = svgTag('svg', { viewBox: '0 0 14 14', class: 'am-tree-icon' });
  svg.appendChild(svgTag('path', { d: 'M2.5,1.5 L8,1.5 L11.5,5 L11.5,12.5 L2.5,12.5 Z', fill: '#eef2fb', stroke: '#7b8aa6', 'stroke-width': 1, 'stroke-linejoin': 'round' }));
  svg.appendChild(svgTag('path', { d: 'M8,1.5 L8,5 L11.5,5', fill: 'none', stroke: '#7b8aa6', 'stroke-width': 1 }));
  svg.appendChild(svgTag('line', { x1: 4.3, y1: 7.3, x2: 9.7, y2: 7.3, stroke: '#7b8aa6', 'stroke-width': 1 }));
  svg.appendChild(svgTag('line', { x1: 4.3, y1: 9.4, x2: 9.7, y2: 9.4, stroke: '#7b8aa6', 'stroke-width': 1 }));
  return svg;
}

interface ContextMenuItem { label: string; action: () => void; disabled?: boolean; }
type DropTarget = { type: 'folder'; path: string } | { type: 'root' };

export interface ArchimateDesignerOptions {
  model?: ArchimateModel;
  onSave?: (json: ViewData & { viewPath: string }) => void;
  storageKey?: string;
  /** Path-addressed adapter (see src/webview/storage/*.ts); defaults to LocalStorageAdapter. */
  storage?: StorageAdapter;
}

export class ArchimateDesigner {
  container: HTMLElement;
  model: ArchimateModel;
  onSave: ArchimateDesignerOptions['onSave'] | null;
  storageKey: string;
  storage: StorageAdapter;
  zoom = 1;
  pan = { x: 40, y: 40 };
  selected = new Set<string>();
  activeRelType: RelationshipType | null = null;
  pendingSource: string | null = null;
  currentViewPath: string | null = null;
  paletteCollapsed = false;
  externalFileUri: string | null = null;
  renderer!: Renderer;

  // DOM refs, assigned during _buildDom()
  private viewsPanel!: HTMLDivElement;
  private viewsList!: HTMLDivElement;
  private rightDock!: HTMLDivElement;
  private palette!: HTMLDivElement;
  private inspector!: HTMLDivElement;
  private canvasWrap!: HTMLDivElement;
  private svg!: SVGSVGElement;
  private statusEl!: HTMLDivElement;
  private zoomLabel!: HTMLSpanElement;
  private paletteScroll!: HTMLDivElement;

  private expandedFolders: Set<string> | null = null;
  private treeCache: TreeEntry[] = [];
  private spaceDown = false;
  private justDragged = false;
  private folderClickTimer: ReturnType<typeof setTimeout> | undefined;
  private viewClickTimer: ReturnType<typeof setTimeout> | undefined;
  private changeTimer: ReturnType<typeof setTimeout> | undefined;
  private statusTimer: ReturnType<typeof setTimeout> | undefined;
  private contextMenu: HTMLDivElement | null = null;

  constructor(container: HTMLElement, opts: ArchimateDesignerOptions = {}) {
    this.container = container;
    this.model = opts.model || new ArchimateModel();
    this.onSave = opts.onSave || null;
    this.storageKey = opts.storageKey || 'archimate-designer';
    this.storage = opts.storage || new LocalStorageAdapter({ storageKey: this.storageKey });

    this._buildDom();
    this.renderer = new Renderer(this.svg, this.model, {
      onElementPointerDown: (e, id) => this._onElementPointerDown(e, id),
      onEdgeClick: (e, id) => this._onEdgeClick(e, id),
      onHingePointerDown: (e, relId, end) => this._onHingePointerDown(e, relId, end),
      onResizeHandlePointerDown: (e, elId, handle) => this._onResizeHandlePointerDown(e, elId, handle),
    });
    this._wireCanvasEvents();
    this.renderer.fullRender();
    this._applyTransform();
    this._renderViewsList();
  }

  // ================= DOM scaffold =================
  private _buildDom(): void {
    this.container.classList.add('am-designer');
    this.container.innerHTML = '';

    this.viewsPanel = el('div', 'am-views-panel');
    this._buildViewsPanel();

    const main = el('div', 'am-main');
    const toolbar = el('div', 'am-toolbar');
    this._buildToolbar(toolbar);
    const canvasWrap = el('div', 'am-canvas-wrap');
    this.svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    this.svg.setAttribute('class', 'am-svg');
    canvasWrap.appendChild(this.svg);
    main.appendChild(toolbar);
    main.appendChild(canvasWrap);
    this.canvasWrap = canvasWrap;

    this.rightDock = el('div', 'am-right-dock');
    this._buildRightDock();

    // this.container.appendChild(this.viewsPanel); // Views panel removed
    this.container.appendChild(main);
    this.container.appendChild(this.rightDock);
  }

  // ---------------- Views panel (left) ----------------
  private _buildViewsPanel(): void {
    this.viewsPanel.innerHTML = '';
    const header = el('div', 'am-panel-header');
    header.textContent = 'Views';
    const newFolderBtn = el('button', 'am-btn am-btn-sm', { title: 'New folder' });
    newFolderBtn.textContent = '+ Folder';
    newFolderBtn.addEventListener('click', () => this.createFolder());
    const newViewBtn = el('button', 'am-btn am-btn-sm', { title: 'Start a new blank view' });
    newViewBtn.textContent = '+ View';
    newViewBtn.addEventListener('click', () => this.newView());
    header.append(newFolderBtn, newViewBtn);
    this.viewsList = el('div', 'am-views-list');
    this.viewsPanel.appendChild(header);
    this.viewsPanel.appendChild(this.viewsList);
  }

  private _expandedKey(): string { return `${this.storageKey}:expanded-folders`; }

  private _loadExpanded(): Set<string> {
    if (this.expandedFolders) return this.expandedFolders;
    try { this.expandedFolders = new Set(JSON.parse(localStorage.getItem(this._expandedKey()) || '[]')); }
    catch { this.expandedFolders = new Set(); }
    return this.expandedFolders;
  }
  private _saveExpanded(): void {
    try { localStorage.setItem(this._expandedKey(), JSON.stringify([...this._loadExpanded()])); } catch { /* ignore */ }
  }
  private _toggleFolder(path: string): void {
    const set = this._loadExpanded();
    if (set.has(path)) set.delete(path); else set.add(path);
    this._saveExpanded();
    this._renderViewsList();
  }

  // Everything below addresses folders/views by a "/"-joined relative path
  // (matching the real directory layout a filesystem-backed adapter keeps on disk).
  private _reprefixPath(p: string, oldPrefix: string, newPrefix: string): string {
    if (p === oldPrefix) return newPrefix;
    if (p.startsWith(`${oldPrefix}/`)) return newPrefix + p.slice(oldPrefix.length);
    return p;
  }
  // After a folder is renamed/moved, fix up any local (non-persisted-by-path)
  // state that referenced the old path.
  private _reprefixLocalState(oldPrefix: string, newPrefix: string): void {
    if (this.currentViewPath) this.currentViewPath = this._reprefixPath(this.currentViewPath, oldPrefix, newPrefix);
    this.expandedFolders = new Set([...this._loadExpanded()].map(p => this._reprefixPath(p, oldPrefix, newPrefix)));
    this._saveExpanded();
  }
  private _sanitizeName(name: string): string { return String(name).replace(/[\\/]/g, '-').trim(); }
  private _uniqueName(base: string, siblingNames: Set<string>): string {
    if (!siblingNames.has(base)) return base;
    let i = 2;
    while (siblingNames.has(`${base} ${i}`)) i++;
    return `${base} ${i}`;
  }

  async createFolder(name = 'New Folder', parentPath: string | null = null): Promise<string> {
    const tree = await this._loadTree();
    const siblings = new Set(tree.filter(e => (e.parentPath || null) === (parentPath || null)).map(e => e.name));
    const finalName = this._uniqueName(this._sanitizeName(name), siblings);
    const path = parentPath ? `${parentPath}/${finalName}` : finalName;
    await this.storage.createFolder(path);
    this._loadExpanded().add(path);
    this._saveExpanded();
    await this._renderViewsList();
    return path;
  }

  async renameFolder(path: string, name: string): Promise<void> {
    const finalName = this._sanitizeName(name);
    const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : null;
    const newPath = parentPath ? `${parentPath}/${finalName}` : finalName;
    if (newPath !== path) {
      await this.storage.rename(path, newPath);
      this._reprefixLocalState(path, newPath);
    }
    await this._renderViewsList();
  }

  async deleteFolder(path: string): Promise<void> {
    const affectsCurrent = this.currentViewPath === path || (this.currentViewPath || '').startsWith(`${path}/`);
    await this.storage.deleteFolder(path);
    if (affectsCurrent) this.currentViewPath = null; // contents were reparented on disk; drop the stale binding
    this._loadExpanded().delete(path);
    this._saveExpanded();
    await this._renderViewsList();
  }

  private _isDescendantPath(candidate: string, ancestor: string): boolean {
    return candidate === ancestor || candidate.startsWith(`${ancestor}/`);
  }

  async moveViewToFolder(viewPath: string, folderPath: string | null): Promise<void> {
    const name = viewPath.includes('/') ? viewPath.slice(viewPath.lastIndexOf('/') + 1) : viewPath;
    const newPath = folderPath ? `${folderPath}/${name}` : name;
    if (newPath === viewPath) return;
    await this.storage.rename(viewPath, newPath);
    if (this.currentViewPath === viewPath) this.currentViewPath = newPath;
    await this._renderViewsList();
  }

  async moveFolderToFolder(folderPath: string, targetParentPath: string | null): Promise<void> {
    if (folderPath === targetParentPath) return;
    if (targetParentPath && this._isDescendantPath(targetParentPath, folderPath)) return; // no cycles
    const name = folderPath.includes('/') ? folderPath.slice(folderPath.lastIndexOf('/') + 1) : folderPath;
    const newPath = targetParentPath ? `${targetParentPath}/${name}` : name;
    if (newPath === folderPath) return;
    await this.storage.rename(folderPath, newPath);
    this._reprefixLocalState(folderPath, newPath);
    await this._renderViewsList();
  }

  // ---------------- tree rendering ----------------
  private async _loadTree(): Promise<TreeEntry[]> {
    this.treeCache = await this.storage.listTree();
    return this.treeCache;
  }

  private async _renderViewsList(): Promise<void> {
    const tree = await this._loadTree();
    this.viewsList.innerHTML = '';
    if (!tree.length) {
      const empty = el('div', 'am-views-empty');
      empty.textContent = 'No saved views yet. Build a diagram and click Save.';
      this.viewsList.appendChild(empty);
      return;
    }
    const folders = tree.filter(e => e.type === 'folder');
    const views = tree.filter(e => e.type === 'view');
    const rootFolders = folders.filter(f => !f.parentPath).sort((a, b) => a.name.localeCompare(b.name));
    const rootViews = views.filter(v => !v.parentPath).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    for (const f of rootFolders) this._renderFolderNode(f, folders, views, 0);
    for (const v of rootViews) this._renderViewNode(v, 0);
  }

  private _renderFolderNode(folder: TreeEntry, allFolders: TreeEntry[], allViews: TreeEntry[], depth: number): void {
    const expanded = this._loadExpanded().has(folder.path);
    const row = el('div', 'am-tree-row am-folder-row', { 'data-folder-path': folder.path });
    row.style.paddingLeft = `${6 + depth * 15}px`;
    const caret = el('span', 'am-caret');
    caret.textContent = expanded ? '▾' : '▸';
    const icon = folderGlyph(expanded);
    const nameEl = el('span', 'am-tree-name');
    nameEl.textContent = folder.name;
    nameEl.title = 'Click to expand/collapse · double-click to rename';
    const delBtn = el('button', 'am-view-delete', { title: 'Delete folder (contents move up a level)' });
    delBtn.textContent = '×';
    delBtn.addEventListener('click', (e) => { e.stopPropagation(); this.deleteFolder(folder.path); });
    row.append(caret, icon, nameEl, delBtn);

    // Debounce single-click so a double-click isn't preceded by a toggle
    // that rebuilds this list and destroys the in-progress rename input.
    row.addEventListener('click', () => {
      if (this.justDragged) return;
      clearTimeout(this.folderClickTimer);
      this.folderClickTimer = setTimeout(() => this._toggleFolder(folder.path), 240);
    });
    nameEl.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      clearTimeout(this.folderClickTimer);
      this._renameFolderInline(folder, nameEl);
    });
    row.addEventListener('pointerdown', (e) => this._startTreeDrag(e, 'folder', folder.path, folder.name));

    this.viewsList.appendChild(row);
    if (expanded) {
      const childFolders = allFolders.filter(f => f.parentPath === folder.path).sort((a, b) => a.name.localeCompare(b.name));
      const childViews = allViews.filter(v => v.parentPath === folder.path).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      for (const cf of childFolders) this._renderFolderNode(cf, allFolders, allViews, depth + 1);
      for (const cv of childViews) this._renderViewNode(cv, depth + 1);
    }
  }

  private _renderViewNode(v: TreeEntry, depth: number): void {
    const item = el('div', 'am-tree-row am-view-item' + (v.path === this.currentViewPath ? ' am-active' : ''));
    item.style.paddingLeft = `${6 + depth * 15}px`;
    item.appendChild(fileGlyph());
    const nameEl = el('span', 'am-tree-name');
    nameEl.textContent = v.name;
    nameEl.title = 'Click to open · double-click to rename';
    const metaEl = el('span', 'am-view-meta');
    metaEl.textContent = v.updatedAt ? fmtTime(v.updatedAt) : '';
    const delBtn = el('button', 'am-view-delete', { title: 'Delete view' });
    delBtn.textContent = '×';
    delBtn.addEventListener('click', (e) => { e.stopPropagation(); this.deleteView(v.path); });
    // Debounce single-click so a double-click isn't preceded by a loadView()
    // that rebuilds this list and destroys the in-progress rename input.
    nameEl.addEventListener('click', () => {
      if (this.justDragged) return;
      clearTimeout(this.viewClickTimer);
      this.viewClickTimer = setTimeout(() => this.loadView(v.path), 240);
    });
    nameEl.addEventListener('dblclick', () => {
      clearTimeout(this.viewClickTimer);
      this._renameInline(v, nameEl);
    });
    item.append(nameEl, metaEl, delBtn);
    item.addEventListener('pointerdown', (e) => this._startTreeDrag(e, 'view', v.path, v.name));
    this.viewsList.appendChild(item);
  }

  // drag a view/folder row; only engages after the pointer moves past a
  // threshold, so a plain click still reaches the click/dblclick handlers
  private _startTreeDrag(e: PointerEvent, kind: 'view' | 'folder', path: string, label: string): void {
    if (e.button !== undefined && e.button !== 0) return;
    const startX = e.clientX, startY = e.clientY;
    let dragging = false, ghost: HTMLDivElement | null = null, dropTarget: DropTarget | null = null;
    const clearHover = () => this.viewsList.querySelectorAll('.am-drop-hover').forEach(n => n.classList.remove('am-drop-hover'));
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (!dragging && Math.hypot(dx, dy) > 5) {
        dragging = true;
        ghost = el('div', 'am-drag-ghost');
        ghost.textContent = label;
        document.body.appendChild(ghost);
      }
      if (!dragging || !ghost) return;
      ghost.style.left = `${ev.clientX + 12}px`;
      ghost.style.top = `${ev.clientY + 12}px`;
      clearHover();
      const under = document.elementFromPoint(ev.clientX, ev.clientY);
      const folderRow = under?.closest<HTMLElement>('.am-folder-row');
      if (folderRow && folderRow.dataset.folderPath !== path) {
        folderRow.classList.add('am-drop-hover');
        dropTarget = { type: 'folder', path: folderRow.dataset.folderPath! };
      } else if (under && this.viewsList.contains(under)) {
        this.viewsList.classList.add('am-drop-hover');
        dropTarget = { type: 'root' };
      } else {
        dropTarget = null;
      }
    };
    const up = async () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (dragging) {
        ghost?.remove();
        clearHover();
        this.viewsList.classList.remove('am-drop-hover');
        if (dropTarget) {
          const targetFolderPath = dropTarget.type === 'folder' ? dropTarget.path : null;
          if (kind === 'view') await this.moveViewToFolder(path, targetFolderPath);
          else await this.moveFolderToFolder(path, targetFolderPath);
        }
        this.justDragged = true;
        setTimeout(() => { this.justDragged = false; }, 0);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  private _renameFolderInline(folder: TreeEntry, nameEl: HTMLElement): void {
    const input = el('input', 'am-view-rename-input');
    input.value = folder.name;
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    const commit = () => {
      const val = input.value.trim();
      if (val) this.renameFolder(folder.path, val);
      else this._renderViewsList();
    };
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.keyCode === 13) input.blur();
      if (e.key === 'Escape') { input.value = folder.name; input.blur(); }
    });
  }

  private _renameInline(view: TreeEntry, nameEl: HTMLElement): void {
    const input = el('input', 'am-view-rename-input');
    input.value = view.name;
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    const commit = () => {
      const val = input.value.trim();
      if (val) this.renameView(view.path, val);
      else this._renderViewsList();
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.keyCode === 13) input.blur();
      if (e.key === 'Escape') { input.value = view.name; input.blur(); }
    });
  }

  newView(): void {
    this.model = new ArchimateModel();
    this.renderer.model = this.model;
    this.currentViewPath = null;
    this.renderer.fullRender();
    this.resetView();
    this._setSelection(new Set());
    this._renderViewsList();
    this._flashStatus('New blank view. Click Save to keep it.');
  }

  async loadView(path: string): Promise<boolean> {
    try {
      const data = await this.storage.readView(path);
      this.load(data);
      this.currentViewPath = path;
      await this._renderViewsList();
      this._flashStatus(`Loaded "${path.split('/').pop()}".`);
      return true;
    } catch { return false; }
  }

  async renameView(path: string, name: string): Promise<void> {
    const finalName = this._sanitizeName(name);
    const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : null;
    const newPath = parentPath ? `${parentPath}/${finalName}` : finalName;
    if (newPath !== path) {
      await this.storage.rename(path, newPath);
      if (this.currentViewPath === path) this.currentViewPath = newPath;
    }
    await this._renderViewsList();
  }

  async deleteView(path: string): Promise<void> {
    await this.storage.deleteView(path);
    if (this.currentViewPath === path) this.currentViewPath = null;
    await this._renderViewsList();
  }

  // ---------------- Right dock: palette + inspector ----------------
  private _buildRightDock(): void {
    this.rightDock.innerHTML = '';
    const collapsedTab = el('button', 'am-dock-collapsed-tab', { title: 'Show palette' });
    collapsedTab.innerHTML = '<span>◂ Palette</span>';
    collapsedTab.addEventListener('click', () => this._setPaletteCollapsed(false));

    const dockContent = el('div', 'am-dock-content');
    this.palette = el('div', 'am-palette');
    this._buildPalette();
    this.inspector = el('div', 'am-inspector');
    this._buildInspector();
    dockContent.appendChild(this.palette);
    dockContent.appendChild(this.inspector);

    this.rightDock.appendChild(collapsedTab);
    this.rightDock.appendChild(dockContent);
    this._setPaletteCollapsed(false);
  }

  private _setPaletteCollapsed(collapsed: boolean): void {
    this.paletteCollapsed = collapsed;
    this.rightDock.classList.toggle('am-collapsed', collapsed);
  }

  private _buildPalette(): void {
    this.palette.innerHTML = '';
    const header = el('div', 'am-panel-header');
    header.textContent = 'Palette';
    const collapseBtn = el('button', 'am-collapse-btn', { title: 'Collapse palette' });
    collapseBtn.textContent = '▸';
    collapseBtn.addEventListener('click', () => this._setPaletteCollapsed(true));
    header.appendChild(collapseBtn);
    this.palette.appendChild(header);

    const search = el('input', 'am-palette-search');
    search.placeholder = 'Filter…';
    search.addEventListener('input', () => this._filterPalette(search.value.trim().toLowerCase()));
    this.palette.appendChild(search);

    const scroll = el('div', 'am-palette-scroll');

    // Relationships first, mirroring how connector tools lead an ArchiMate palette.
    const relSection = el('div', 'am-palette-section');
    const relHeader = el('div', 'am-palette-header am-palette-header-rel');
    relHeader.textContent = 'Relationships';
    relHeader.addEventListener('click', () => relSection.classList.toggle('am-collapsed'));
    relSection.appendChild(relHeader);
    const relGrid = el('div', 'am-icon-grid');
    for (const type of RELATIONSHIP_LIST) {
      const btn = el('button', 'am-icon-btn am-icon-btn-rel', { title: humanize(type), type: 'button' });
      btn.dataset.rel = type;
      btn.appendChild(relationshipIcon(type));
      btn.addEventListener('click', () => this._setRelationshipTool(type, btn));
      relGrid.appendChild(btn);
    }
    relSection.appendChild(relGrid);
    scroll.appendChild(relSection);

    for (const group of PALETTE_GROUPS) {
      const layer = LAYERS[group.layer];
      const section = el('div', 'am-palette-section');
      const header2 = el('div', 'am-palette-header');
      header2.style.setProperty('--am-layer-color', layer.color);
      header2.style.setProperty('--am-layer-stroke', layer.stroke);
      header2.textContent = layer.label;
      header2.addEventListener('click', () => section.classList.toggle('am-collapsed'));
      section.appendChild(header2);
      const grid = el('div', 'am-icon-grid');
      for (const type of group.types) {
        const btn = el('button', 'am-icon-btn', { title: humanize(type), type: 'button' });
        btn.dataset.type = type;
        btn.style.setProperty('--am-layer-stroke', layer.stroke);
        btn.appendChild(elementIcon(type));
        btn.addEventListener('pointerdown', (e) => this._startPaletteDrag(e, type));
        grid.appendChild(btn);
      }
      section.appendChild(grid);
      scroll.appendChild(section);
    }

    this.palette.appendChild(scroll);
    this.paletteScroll = scroll;
  }

  private _filterPalette(q: string): void {
    const items = this.paletteScroll.querySelectorAll<HTMLElement>('.am-icon-btn[data-type]');
    for (const item of items) {
      const label = item.title.toLowerCase();
      item.style.display = !q || label.includes(q) ? '' : 'none';
    }
    for (const section of this.paletteScroll.querySelectorAll<HTMLElement>('.am-palette-section')) {
      const typeItems = section.querySelectorAll<HTMLElement>('.am-icon-btn[data-type]');
      if (!typeItems.length) continue;
      const visible = [...typeItems].some(i => i.style.display !== 'none');
      section.style.display = !q || visible ? '' : 'none';
      if (q && visible) section.classList.remove('am-collapsed');
    }
  }

  private _buildToolbar(toolbar: HTMLDivElement): void {
    const status = el('div', 'am-status');
    status.textContent = 'Drag elements from the palette onto the canvas.';
    this.statusEl = status;
    const spacer = el('div', 'am-toolbar-spacer');
    const zoomOut = el('button', 'am-btn', { title: 'Zoom out' }); zoomOut.textContent = '−';
    zoomOut.addEventListener('click', () => this.setZoom(this.zoom * 0.85));
    const zoomLabel = el('span', 'am-zoom-label'); zoomLabel.textContent = '100%';
    this.zoomLabel = zoomLabel;
    const zoomIn = el('button', 'am-btn', { title: 'Zoom in' }); zoomIn.textContent = '+';
    zoomIn.addEventListener('click', () => this.setZoom(this.zoom * 1.15));
    const zoomReset = el('button', 'am-btn', { title: 'Reset zoom' }); zoomReset.textContent = '⤢';
    zoomReset.addEventListener('click', () => this.resetView());
    const del = el('button', 'am-btn', { title: 'Delete selected' }); del.textContent = 'Delete';
    del.addEventListener('click', () => this.deleteSelected());
    const saveBtn = el('button', 'am-btn am-btn-primary', { title: 'Save view' }); saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', () => this.save());
    const exportBtn = el('button', 'am-btn', { title: 'Export JSON file' }); exportBtn.textContent = 'Export';
    exportBtn.addEventListener('click', () => this.exportJSON());
    const importInput = el('input', 'am-hidden', { type: 'file', accept: 'application/json' });
    importInput.addEventListener('change', (e) => this._importFile(e));
    const importBtn = el('button', 'am-btn', { title: 'Import JSON file' }); importBtn.textContent = 'Import';
    importBtn.addEventListener('click', () => importInput.click());

    toolbar.append(status, spacer, zoomOut, zoomLabel, zoomIn, zoomReset, del, importBtn, importInput, exportBtn, saveBtn);
  }

  private _buildInspector(): void {
    this.inspector.innerHTML = '<div class="am-inspector-empty">Select an element or relationship to edit its properties.</div>';
  }

  // ================= palette drag-to-create =================
  private _startPaletteDrag(e: PointerEvent, type: ElementType): void {
    e.preventDefault();
    const def = ELEMENT_TYPES[type];
    const ghost = el('div', 'am-drag-ghost');
    ghost.textContent = humanize(type);
    ghost.style.setProperty('--am-layer-color', LAYERS[def.layer].color);
    ghost.style.setProperty('--am-layer-stroke', LAYERS[def.layer].stroke);
    document.body.appendChild(ghost);
    const move = (ev: PointerEvent) => {
      ghost.style.left = ev.clientX + 12 + 'px';
      ghost.style.top = ev.clientY + 12 + 'px';
      const overCanvas = this._pointInCanvas(ev.clientX, ev.clientY);
      this.canvasWrap.classList.toggle('am-drop-target', overCanvas);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      ghost.remove();
      this.canvasWrap.classList.remove('am-drop-target');
      if (this._pointInCanvas(ev.clientX, ev.clientY)) {
        const pt = this._clientToWorld(ev.clientX, ev.clientY);
        this.addElement(type, pt.x - 70, pt.y - 27);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  private _pointInCanvas(cx: number, cy: number): boolean {
    const r = this.canvasWrap.getBoundingClientRect();
    return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
  }
  private _clientToWorld(cx: number, cy: number): { x: number; y: number } {
    const r = this.svg.getBoundingClientRect();
    return { x: (cx - r.left - this.pan.x) / this.zoom, y: (cy - r.top - this.pan.y) / this.zoom };
  }

  // ================= relationship tool =================
  private _setRelationshipTool(type: RelationshipType, itemEl: HTMLElement): void {
    const already = this.activeRelType === type;
    this.paletteScroll.querySelectorAll('.am-icon-btn-rel').forEach(i => i.classList.remove('am-active'));
    this.activeRelType = already ? null : type;
    this.pendingSource = null;
    if (this.activeRelType) {
      itemEl.classList.add('am-active');
      this.statusEl.textContent = `Click a source element, then a target element to draw a ${humanize(type)} relationship. Esc to cancel.`;
    } else {
      this.statusEl.textContent = 'Drag elements from the palette onto the canvas.';
    }
  }

  // ================= element interactions =================
  private _onElementPointerDown(e: PointerEvent, id: string): void {
    e.stopPropagation();
    if (this.activeRelType) {
      if (!this.pendingSource) {
        this.pendingSource = id;
        this._setSelection(new Set([id]));
        this.statusEl.textContent = `Source selected. Click a target element for ${humanize(this.activeRelType)}.`;
      } else {
        const type = this.activeRelType;
        const source = this.pendingSource;
        this.pendingSource = null;
        this.paletteScroll.querySelectorAll('.am-icon-btn-rel').forEach(i => i.classList.remove('am-active'));
        this.activeRelType = null;
        if (source !== id) this.addRelationship(type, source, id);
        this.statusEl.textContent = 'Drag elements from the palette onto the canvas.';
        this._setSelection(new Set());
      }
      return;
    }
    if (e.shiftKey) {
      const next = new Set(this.selected);
      if (next.has(id)) next.delete(id); else next.add(id);
      this._setSelection(next);
      return;
    }
    if (!this.selected.has(id) || this.selected.size <= 1) this._setSelection(new Set([id]));

    // Move every selected element together, keyed off the one that was
    // actually grabbed (its box drives alignment-guide snapping).
    const movingIds = [...this.selected].filter(sid => this.model.elements.has(sid));
    if (!movingIds.includes(id)) movingIds.push(id);
    const movingSet = new Set(movingIds);
    const starts = new Map(movingIds.map(mid => {
      const m = this.model.getElement(mid)!;
      return [mid, { x: m.x, y: m.y }] as const;
    }));
    const primary = this.model.getElement(id)!;
    const others = [...this.model.elements.values()].filter(o => !movingSet.has(o.id)).map(o => o.bounds());
    const startX = e.clientX, startY = e.clientY;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / this.zoom;
      const dy = (ev.clientY - startY) / this.zoom;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) moved = true;
      const primaryStart = starts.get(id)!;
      const threshold = GUIDE_SNAP_PX / this.zoom;
      const snap = computeMoveSnap({ x: primaryStart.x + dx, y: primaryStart.y + dy, w: primary.w, h: primary.h }, others, threshold);
      const snapDx = dx + snap.dx, snapDy = dy + snap.dy;
      for (const mid of movingIds) {
        const s = starts.get(mid)!;
        const m = this.model.getElement(mid)!;
        m.x = s.x + snapDx;
        m.y = s.y + snapDy;
        this.renderer.moveElementDom(m);
        this.renderer.rerouteConnected(mid);
      }
      this.renderer.showGuides(snap.guides);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      this.renderer.clearGuides();
      if (moved) this._afterModelChange();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  private _onEdgeClick(e: PointerEvent, id: string): void {
    if (this.activeRelType) return;
    if (e.shiftKey) {
      const next = new Set(this.selected);
      if (next.has(id)) next.delete(id); else next.add(id);
      this._setSelection(next);
      return;
    }
    this._setSelection(new Set([id]));
  }

  // Drag a connector's source/target hinge point along its element's
  // boundary, snapping the position that runs along the edge to the grid.
  private _onHingePointerDown(e: PointerEvent, relId: string, end: 'source' | 'target'): void {
    e.preventDefault();
    const rel = this.model.relationships.get(relId);
    if (!rel) return;
    const elId = end === 'source' ? rel.source : rel.target;
    const elModel = this.model.getElement(elId);
    if (!elModel) return;
    this._setSelection(new Set([relId]));
    const move = (ev: PointerEvent) => {
      const world = this._clientToWorld(ev.clientX, ev.clientY);
      const snapped = snappedPerimeterPoint(elModel.bounds(), world.x, world.y, GRID_SIZE);
      const port = { side: snapped.side, t: snapped.t };
      if (end === 'source') rel.sourcePort = port; else rel.targetPort = port;
      this.renderer.renderEdge(rel);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      this._afterModelChange();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // Resize an element by dragging one of its 8 handles: snaps the moving
  // edge to other elements' edges/centers first (PowerPoint-style smart
  // guides), falling back to the grid when nothing else lines up.
  private _onResizeHandlePointerDown(e: PointerEvent, elId: string, handle: ResizeHandle): void {
    e.preventDefault();
    const elModel = this.model.getElement(elId);
    if (!elModel) return;
    this._setSelection(new Set([elId]));
    const start = { x: elModel.x, y: elModel.y, w: elModel.w, h: elModel.h };
    const startWorld = this._clientToWorld(e.clientX, e.clientY);
    const others = [...this.model.elements.values()].filter(o => o.id !== elId).map(o => o.bounds());
    const move = (ev: PointerEvent) => {
      const world = this._clientToWorld(ev.clientX, ev.clientY);
      const dx = world.x - startWorld.x, dy = world.y - startWorld.y;
      let box = computeResizedBox(start, handle, dx, dy);
      box = enforceMinSize(start, handle, box);
      const threshold = GUIDE_SNAP_PX / this.zoom;
      const snap = computeResizeSnap(handle, box, others, threshold, GRID_SIZE);
      elModel.x = snap.x; elModel.y = snap.y; elModel.w = snap.w; elModel.h = snap.h;
      this.renderer.updateElementGeometry(elModel);
      this.renderer.rerouteConnected(elId);
      this.renderer.showGuides(snap.guides);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      this.renderer.clearGuides();
      this._afterModelChange();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  private _setSelection(idSet: Set<string>): void {
    this.selected = idSet;
    this.renderer.setSelected(idSet);
    this._renderInspector();
  }

  private _renderInspector(): void {
    this.inspector.innerHTML = '';
    if (this.selected.size !== 1) {
      this.inspector.innerHTML = '<div class="am-inspector-empty">Select an element or relationship to edit its properties.</div>';
      return;
    }
    const id = [...this.selected][0];
    const elModel = this.model.getElement(id);
    const relModel = this.model.relationships.get(id);
    if (elModel) {
      const title = el('div', 'am-inspector-title'); title.textContent = humanize(elModel.type);
      const nameLabel = el('label', 'am-field-label'); nameLabel.textContent = 'Name';
      const nameInput = el('input', 'am-field-input');
      nameInput.value = elModel.name;
      nameInput.addEventListener('input', () => { elModel.name = nameInput.value; this.renderer.updateElementLabel(elModel); });
      nameInput.addEventListener('change', () => this._afterModelChange());
      const docLabel = el('label', 'am-field-label'); docLabel.textContent = 'Documentation';
      const docInput = el('textarea', 'am-field-textarea');
      docInput.value = elModel.documentation || '';
      docInput.addEventListener('change', () => { elModel.documentation = docInput.value; this._afterModelChange(); });
      this.inspector.append(title, nameLabel, nameInput, docLabel, docInput);
    } else if (relModel) {
      const title = el('div', 'am-inspector-title'); title.textContent = humanize(relModel.type);
      const nameLabel = el('label', 'am-field-label'); nameLabel.textContent = 'Label';
      const nameInput = el('input', 'am-field-input');
      nameInput.value = relModel.name || '';
      nameInput.addEventListener('input', () => { relModel.name = nameInput.value; this.renderer.renderEdge(relModel); });
      nameInput.addEventListener('change', () => this._afterModelChange());
      const rerouteBtn = el('button', 'am-btn'); rerouteBtn.textContent = 'Auto-route again';
      rerouteBtn.title = 'Clear manual bend/hinge points and let the router pick again';
      rerouteBtn.addEventListener('click', () => {
        relModel.bendpoints = null;
        relModel.sourcePort = null;
        relModel.targetPort = null;
        this.renderer.renderEdge(relModel);
        this._afterModelChange();
      });
      this.inspector.append(title, nameLabel, nameInput, rerouteBtn);
    }
  }

  // ================= canvas-level events =================
  private _wireCanvasEvents(): void {
    this.svg.addEventListener('pointerdown', (e) => {
      if (e.target === this.svg || (e.target as Element).classList?.contains('am-viewport')) {
        if (this.activeRelType) {
          this.activeRelType = null; this.pendingSource = null;
          this.paletteScroll.querySelectorAll('.am-icon-btn-rel').forEach(i => i.classList.remove('am-active'));
          this.statusEl.textContent = 'Drag elements from the palette onto the canvas.';
          return;
        }
        if (e.button === 1 || this.spaceDown) { e.preventDefault(); this._startPan(e); return; }
        if (e.button !== 0) return;
        this._startMarquee(e);
      }
    });
    this.svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = Math.pow(1.0015, -e.deltaY);
      this.setZoom(this.zoom * factor, { clientX: e.clientX, clientY: e.clientY });
    }, { passive: false });
    this.svg.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this._showContextMenu(e.clientX, e.clientY, [
        { label: 'Select All', action: () => this.selectAll() },
        { label: 'Deselect All', action: () => this._setSelection(new Set()), disabled: !this.selected.size },
        { label: 'Delete Selected', action: () => this.deleteSelected(), disabled: !this.selected.size },
      ]);
    });
    window.addEventListener('keydown', (e) => {
      const typing = ['INPUT', 'TEXTAREA'].includes((document.activeElement as HTMLElement)?.tagName);
      if (e.code === 'Space' && !typing && !this.spaceDown) { this.spaceDown = true; this.svg.classList.add('am-space-pan'); }
      if (!this.container.contains(document.activeElement) && document.activeElement !== document.body) return;
      if (!typing && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        this.selectAll();
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected.size && !typing) {
        e.preventDefault();
        this.deleteSelected();
      }
      if (e.key === 'Escape') {
        this.activeRelType = null; this.pendingSource = null;
        this.paletteScroll.querySelectorAll('.am-icon-btn-rel').forEach(i => i.classList.remove('am-active'));
        this.statusEl.textContent = 'Drag elements from the palette onto the canvas.';
        this._closeContextMenu();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') { this.spaceDown = false; this.svg.classList.remove('am-space-pan'); }
    });
  }

  selectAll(): void {
    const ids = [...this.model.elements.keys(), ...this.model.relationships.keys()];
    this._setSelection(new Set(ids));
  }

  private _showContextMenu(x: number, y: number, items: ContextMenuItem[]): void {
    this._closeContextMenu();
    const menu = el('div', 'am-context-menu', { style: `left:${x}px; top:${y}px` });
    for (const item of items) {
      const row = el('div', 'am-context-item' + (item.disabled ? ' am-disabled' : ''));
      row.textContent = item.label;
      if (!item.disabled) row.addEventListener('click', () => { item.action(); this._closeContextMenu(); });
      menu.appendChild(row);
    }
    document.body.appendChild(menu);
    this.contextMenu = menu;
    // Only dismiss on an outside click; closing on any pointerdown (including
    // one inside the menu) would remove the row before its own click fires.
    setTimeout(() => {
      const onPointerDown = (e: PointerEvent) => {
        window.removeEventListener('pointerdown', onPointerDown);
        if (this.contextMenu && !this.contextMenu.contains(e.target as Node)) this._closeContextMenu();
      };
      window.addEventListener('pointerdown', onPointerDown);
    }, 0);
  }

  private _closeContextMenu(): void {
    if (this.contextMenu) { this.contextMenu.remove(); this.contextMenu = null; }
  }

  // PowerPoint-style rubber-band selection: drag from empty canvas to select
  // every element whose bounds intersect the dragged rectangle. Shift adds
  // to the existing selection instead of replacing it.
  private _startMarquee(e: PointerEvent): void {
    const startClient = { x: e.clientX, y: e.clientY };
    const additive = e.shiftKey;
    const baseSelection = new Set(this.selected);
    if (!additive) this._setSelection(new Set());
    const box = el('div', 'am-marquee');
    this.canvasWrap.appendChild(box);
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - startClient.x, ev.clientY - startClient.y) > 3) moved = true;
      if (!moved) return;
      const wrapRect = this.canvasWrap.getBoundingClientRect();
      const left = Math.min(startClient.x, ev.clientX) - wrapRect.left;
      const top = Math.min(startClient.y, ev.clientY) - wrapRect.top;
      box.style.left = `${left}px`;
      box.style.top = `${top}px`;
      box.style.width = `${Math.abs(ev.clientX - startClient.x)}px`;
      box.style.height = `${Math.abs(ev.clientY - startClient.y)}px`;

      const p1 = this._clientToWorld(startClient.x, startClient.y);
      const p2 = this._clientToWorld(ev.clientX, ev.clientY);
      const rx1 = Math.min(p1.x, p2.x), ry1 = Math.min(p1.y, p2.y);
      const rx2 = Math.max(p1.x, p2.x), ry2 = Math.max(p1.y, p2.y);
      const hit = new Set(baseSelection);
      for (const elObj of this.model.elements.values()) {
        const b = elObj.bounds();
        if (b.x < rx2 && b.x + b.w > rx1 && b.y < ry2 && b.y + b.h > ry1) hit.add(elObj.id);
      }
      this._setSelection(hit);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      box.remove();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  private _startPan(e: PointerEvent): void {
    const startX = e.clientX, startY = e.clientY;
    const originPan = { ...this.pan };
    const move = (ev: PointerEvent) => {
      this.pan.x = originPan.x + (ev.clientX - startX);
      this.pan.y = originPan.y + (ev.clientY - startY);
      this._applyTransform();
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // ================= public API =================
  addElement(type: ElementType, x: number, y: number, opts: { name?: string; id?: string } = {}): ArchimateElement {
    const elObj = this.model.addElement({ type, x, y, name: opts.name || humanize(type), id: opts.id });
    this.renderer.renderElement(elObj);
    this._afterModelChange();
    return elObj;
  }

  addRelationship(type: RelationshipType, sourceId: string, targetId: string, opts: { name?: string } = {}): ArchimateRelationship {
    const rel = this.model.addRelationship({ type, source: sourceId, target: targetId, name: opts.name || '' });
    this.renderer.renderEdge(rel);
    this._afterModelChange();
    return rel;
  }

  deleteSelected(): void {
    if (!this.selected.size) return;
    for (const id of this.selected) {
      if (this.model.elements.has(id)) { this.model.removeElement(id); this.renderer.removeElementDom(id); }
      if (this.model.relationships.has(id)) { this.model.removeRelationship(id); this.renderer.removeEdgeDom(id); }
    }
    for (const [id] of [...this.renderer.edgeDom]) {
      if (!this.model.relationships.has(id)) this.renderer.removeEdgeDom(id);
    }
    this._setSelection(new Set());
    this.renderer.rerouteAll();
    this._afterModelChange();
  }

  private _afterModelChange(): void {
    if (this.changeTimer) clearTimeout(this.changeTimer);
    this.changeTimer = setTimeout(() => {
      try { localStorage.setItem(this.storageKey + ':autosave', JSON.stringify(this.model.toJSON())); } catch { /* storage unavailable */ }
    }, 400);
  }

  setZoom(z: number, focal?: { clientX: number; clientY: number }): void {
    const newZoom = Math.min(Math.max(z, 0.2), 3);
    if (focal) {
      const r = this.svg.getBoundingClientRect();
      const fx = focal.clientX - r.left, fy = focal.clientY - r.top;
      const worldX = (fx - this.pan.x) / this.zoom, worldY = (fy - this.pan.y) / this.zoom;
      this.pan.x = fx - worldX * newZoom;
      this.pan.y = fy - worldY * newZoom;
    }
    this.zoom = newZoom;
    this._applyTransform();
  }

  resetView(): void {
    this.zoom = 1;
    this.pan = { x: 40, y: 40 };
    this._applyTransform();
  }

  private _applyTransform(): void {
    this.renderer.viewport.setAttribute('transform', `translate(${this.pan.x},${this.pan.y}) scale(${this.zoom})`);
    this.zoomLabel.textContent = `${Math.round(this.zoom * 100)}%`;
    // keep the CSS background grid aligned with world-space coordinates so
    // it stays under the same elements/points as you pan and zoom
    const minor = GRID_SIZE * this.zoom;
    const major = GRID_SIZE * 5 * this.zoom;
    this.canvasWrap.style.backgroundSize = `${major}px ${major}px, ${major}px ${major}px, ${minor}px ${minor}px, ${minor}px ${minor}px`;
    this.canvasWrap.style.backgroundPosition = `${this.pan.x}px ${this.pan.y}px, ${this.pan.x}px ${this.pan.y}px, ${this.pan.x}px ${this.pan.y}px, ${this.pan.x}px ${this.pan.y}px`;
  }

  /** Save the current canvas as a named view (creating one if none is active). */
  async save(): Promise<ViewData> {
    const json: ViewData = { model: this.model.toJSON(), view: { zoom: this.zoom, pan: this.pan } };
    
    // If this was opened from an external file, save back to that location
    if (this.externalFileUri && this.storage.writeExternalView) {
      await this.storage.writeExternalView(json);
      if (this.onSave) this.onSave({ ...json, viewPath: this.currentViewPath || 'External file' });
      this._flashStatus('Saved to external file.');
      return json;
    }
    
    let path = this.currentViewPath;
    if (!path) {
      const tree = await this._loadTree();
      const rootViewNames = new Set(tree.filter(e => e.type === 'view' && !e.parentPath).map(e => e.name));
      path = this._uniqueName('View', rootViewNames);
    }
    await this.storage.writeView(path, json);
    this.currentViewPath = path;
    if (this.onSave) this.onSave({ ...json, viewPath: path });
    await this._renderViewsList();
    this._flashStatus(`Saved "${path.split('/').pop()}".`);
    return json;
  }

  load(json: ViewData | ModelJSON): void {
    const hasModel = (j: any): j is ViewData => 'model' in j;
    this.model = ArchimateModel.fromJSON(hasModel(json) ? json.model : json);
    this.renderer.model = this.model;
    this.renderer.fullRender();
    if (hasModel(json) && json.view) { this.zoom = json.view.zoom || 1; this.pan = json.view.pan || { x: 40, y: 40 }; this._applyTransform(); }
    this._setSelection(new Set());
  }

  exportJSON(): void {
    const json: ViewData = { model: this.model.toJSON(), view: { zoom: this.zoom, pan: this.pan } };
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'archimate-view.json';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  private _importFile(e: Event): void {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        this.load(JSON.parse(reader.result as string));
        this.currentViewPath = null;
        this._renderViewsList();
        this._flashStatus('Imported. Click Save to add it to your views.');
      } catch (err) { this._flashStatus('Import failed: ' + (err as Error).message); }
    };
    reader.readAsText(file);
    (e.target as HTMLInputElement).value = '';
  }

  private _flashStatus(msg: string): void {
    this.statusEl.textContent = msg;
    clearTimeout(this.statusTimer);
    this.statusTimer = setTimeout(() => { this.statusEl.textContent = 'Drag elements from the palette onto the canvas.'; }, 2400);
  }
}
