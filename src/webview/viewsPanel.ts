// The left "Views" panel: a folder tree of saved views, backed by a
// path-addressed StorageAdapter (real files on disk via the extension host,
// or localStorage in the standalone dev-preview harness). Extracted out of
// ArchimateDesigner, which owns the model/renderer/selection this panel
// needs to poke when a view is created, loaded, or renamed — see
// `ViewsPanelHost` below for that narrow seam.

import { ArchimateModel, ModelJSON } from './model.js';
import type { Renderer } from './renderer.js';
import type { StorageAdapter, TreeEntry, ViewData } from './storage/StorageAdapter.js';
import { el } from './domUtil.js';
import { svgEl } from './svgUtil.js';

type DropTarget = { type: 'folder'; path: string } | { type: 'root' };

/**
 * The slice of ArchimateDesigner this panel needs to read/mutate. Passing
 * the designer instance itself satisfies this structurally — its relevant
 * fields (`storage`, `storageKey`, `currentViewPath`, `model`, `renderer`)
 * are already public, and `_setSelection`/`_flashStatus`/`load` already are
 * too, so no renaming was needed to carve this seam out.
 */
export interface ViewsPanelHost {
  storage: StorageAdapter;
  storageKey: string;
  currentViewPath: string | null;
  model: ArchimateModel;
  renderer: Renderer;
  resetView(): void;
  _setSelection(sel: Set<string>): void;
  _flashStatus(msg: string): void;
  load(json: ViewData | ModelJSON): void;
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString();
}

// Exported so modelTreeView.ts can render its own layer folders with the
// exact same yellow folder icon, rather than duplicating the SVG.
export function folderGlyph(open: boolean): SVGElement {
  const svg = svgEl('svg', { viewBox: '0 0 14 14', class: 'am-tree-icon' });
  const common = { fill: '#dcb35c', stroke: '#a3792f', 'stroke-width': 1, 'stroke-linejoin': 'round' };
  if (open) {
    svg.appendChild(svgEl('path', { d: 'M1,4 L1,11.5 L12.5,11.5 L13.5,5.5 L4,5.5 L3,4 Z', ...common }));
    svg.appendChild(svgEl('path', { d: 'M1,4 L5,4 L6,2.5 L11.5,2.5 L11.5,5.5', fill: 'none', stroke: '#a3792f', 'stroke-width': 1 }));
  } else {
    svg.appendChild(svgEl('path', { d: 'M1,3.5 L5.5,3.5 L6.5,5 L13,5 L13,11.5 L1,11.5 Z', ...common }));
  }
  return svg;
}
function fileGlyph(): SVGElement {
  const svg = svgEl('svg', { viewBox: '0 0 14 14', class: 'am-tree-icon' });
  svg.appendChild(svgEl('path', { d: 'M2.5,1.5 L8,1.5 L11.5,5 L11.5,12.5 L2.5,12.5 Z', fill: '#eef2fb', stroke: '#7b8aa6', 'stroke-width': 1, 'stroke-linejoin': 'round' }));
  svg.appendChild(svgEl('path', { d: 'M8,1.5 L8,5 L11.5,5', fill: 'none', stroke: '#7b8aa6', 'stroke-width': 1 }));
  svg.appendChild(svgEl('line', { x1: 4.3, y1: 7.3, x2: 9.7, y2: 7.3, stroke: '#7b8aa6', 'stroke-width': 1 }));
  svg.appendChild(svgEl('line', { x1: 4.3, y1: 9.4, x2: 9.7, y2: 9.4, stroke: '#7b8aa6', 'stroke-width': 1 }));
  return svg;
}

export class ViewsPanel {
  readonly root: HTMLDivElement;
  private list!: HTMLDivElement;
  private host: ViewsPanelHost;

  private expandedFolders: Set<string> | null = null;
  private treeCache: TreeEntry[] = [];
  private justDragged = false;
  private folderClickTimer: ReturnType<typeof setTimeout> | undefined;
  private viewClickTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(host: ViewsPanelHost) {
    this.host = host;
    this.root = el('div', 'am-views-panel');
    this._build();
  }

  private _build(): void {
    this.root.innerHTML = '';
    const header = el('div', 'am-panel-header');
    header.textContent = 'Views';
    const newFolderBtn = el('button', 'am-btn am-btn-sm', { title: 'New folder' });
    newFolderBtn.textContent = '+ Folder';
    newFolderBtn.addEventListener('click', () => this.createFolder());
    const newViewBtn = el('button', 'am-btn am-btn-sm', { title: 'Start a new blank view' });
    newViewBtn.textContent = '+ View';
    newViewBtn.addEventListener('click', () => this.newView());
    header.append(newFolderBtn, newViewBtn);
    this.list = el('div', 'am-views-list');
    this.root.appendChild(header);
    this.root.appendChild(this.list);
  }

  private _expandedKey(): string { return `${this.host.storageKey}:expanded-folders`; }

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
    this.renderList();
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
    if (this.host.currentViewPath) this.host.currentViewPath = this._reprefixPath(this.host.currentViewPath, oldPrefix, newPrefix);
    this.expandedFolders = new Set([...this._loadExpanded()].map(p => this._reprefixPath(p, oldPrefix, newPrefix)));
    this._saveExpanded();
  }
  private _sanitizeName(name: string): string { return String(name).replace(/[\\/]/g, '-').trim(); }
  uniqueName(base: string, siblingNames: Set<string>): string {
    if (!siblingNames.has(base)) return base;
    let i = 2;
    while (siblingNames.has(`${base} ${i}`)) i++;
    return `${base} ${i}`;
  }

  async createFolder(name = 'New Folder', parentPath: string | null = null): Promise<string> {
    const tree = await this.loadTree();
    const siblings = new Set(tree.filter(e => (e.parentPath || null) === (parentPath || null)).map(e => e.name));
    const finalName = this.uniqueName(this._sanitizeName(name), siblings);
    const path = parentPath ? `${parentPath}/${finalName}` : finalName;
    await this.host.storage.createFolder(path);
    this._loadExpanded().add(path);
    this._saveExpanded();
    await this.renderList();
    return path;
  }

  async renameFolder(path: string, name: string): Promise<void> {
    const finalName = this._sanitizeName(name);
    const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : null;
    const newPath = parentPath ? `${parentPath}/${finalName}` : finalName;
    if (newPath !== path) {
      await this.host.storage.rename(path, newPath);
      this._reprefixLocalState(path, newPath);
    }
    await this.renderList();
  }

  async deleteFolder(path: string): Promise<void> {
    const affectsCurrent = this.host.currentViewPath === path || (this.host.currentViewPath || '').startsWith(`${path}/`);
    await this.host.storage.deleteFolder(path);
    if (affectsCurrent) this.host.currentViewPath = null; // contents were reparented on disk; drop the stale binding
    this._loadExpanded().delete(path);
    this._saveExpanded();
    await this.renderList();
  }

  private _isDescendantPath(candidate: string, ancestor: string): boolean {
    return candidate === ancestor || candidate.startsWith(`${ancestor}/`);
  }

  async moveViewToFolder(viewPath: string, folderPath: string | null): Promise<void> {
    const name = viewPath.includes('/') ? viewPath.slice(viewPath.lastIndexOf('/') + 1) : viewPath;
    const newPath = folderPath ? `${folderPath}/${name}` : name;
    if (newPath === viewPath) return;
    await this.host.storage.rename(viewPath, newPath);
    if (this.host.currentViewPath === viewPath) this.host.currentViewPath = newPath;
    await this.renderList();
  }

  async moveFolderToFolder(folderPath: string, targetParentPath: string | null): Promise<void> {
    if (folderPath === targetParentPath) return;
    if (targetParentPath && this._isDescendantPath(targetParentPath, folderPath)) return; // no cycles
    const name = folderPath.includes('/') ? folderPath.slice(folderPath.lastIndexOf('/') + 1) : folderPath;
    const newPath = targetParentPath ? `${targetParentPath}/${name}` : name;
    if (newPath === folderPath) return;
    await this.host.storage.rename(folderPath, newPath);
    this._reprefixLocalState(folderPath, newPath);
    await this.renderList();
  }

  // ---------------- tree rendering ----------------
  async loadTree(): Promise<TreeEntry[]> {
    this.treeCache = await this.host.storage.listTree();
    return this.treeCache;
  }

  async renderList(): Promise<void> {
    const tree = await this.loadTree();
    this.list.innerHTML = '';
    if (!tree.length) {
      const empty = el('div', 'am-views-empty');
      empty.textContent = 'No saved views yet. Build a diagram and click Save.';
      this.list.appendChild(empty);
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

    this.list.appendChild(row);
    if (expanded) {
      const childFolders = allFolders.filter(f => f.parentPath === folder.path).sort((a, b) => a.name.localeCompare(b.name));
      const childViews = allViews.filter(v => v.parentPath === folder.path).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      for (const cf of childFolders) this._renderFolderNode(cf, allFolders, allViews, depth + 1);
      for (const cv of childViews) this._renderViewNode(cv, depth + 1);
    }
  }

  private _renderViewNode(v: TreeEntry, depth: number): void {
    const item = el('div', 'am-tree-row am-view-item' + (v.path === this.host.currentViewPath ? ' am-active' : ''));
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
    this.list.appendChild(item);
  }

  // drag a view/folder row; only engages after the pointer moves past a
  // threshold, so a plain click still reaches the click/dblclick handlers
  private _startTreeDrag(e: PointerEvent, kind: 'view' | 'folder', path: string, label: string): void {
    if (e.button !== undefined && e.button !== 0) return;
    const startX = e.clientX, startY = e.clientY;
    let dragging = false, ghost: HTMLDivElement | null = null, dropTarget: DropTarget | null = null;
    const clearHover = () => this.list.querySelectorAll('.am-drop-hover').forEach(n => n.classList.remove('am-drop-hover'));
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
      } else if (under && this.list.contains(under)) {
        this.list.classList.add('am-drop-hover');
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
        this.list.classList.remove('am-drop-hover');
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
      else this.renderList();
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
      else this.renderList();
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.keyCode === 13) input.blur();
      if (e.key === 'Escape') { input.value = view.name; input.blur(); }
    });
  }

  newView(): void {
    this.host.model = new ArchimateModel();
    this.host.renderer.model = this.host.model;
    this.host.currentViewPath = null;
    this.host.renderer.fullRender();
    this.host.resetView();
    this.host._setSelection(new Set());
    this.renderList();
    this.host._flashStatus('New blank view. Click Save to keep it.');
  }

  async loadView(path: string): Promise<boolean> {
    try {
      const data = await this.host.storage.readView(path);
      this.host.load(data);
      this.host.currentViewPath = path;
      await this.renderList();
      this.host._flashStatus(`Loaded "${path.split('/').pop()}".`);
      return true;
    } catch { return false; }
  }

  async renameView(path: string, name: string): Promise<void> {
    const finalName = this._sanitizeName(name);
    const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : null;
    const newPath = parentPath ? `${parentPath}/${finalName}` : finalName;
    if (newPath !== path) {
      await this.host.storage.rename(path, newPath);
      if (this.host.currentViewPath === path) this.host.currentViewPath = newPath;
    }
    await this.renderList();
  }

  async deleteView(path: string): Promise<void> {
    await this.host.storage.deleteView(path);
    if (this.host.currentViewPath === path) this.host.currentViewPath = null;
    await this.renderList();
  }
}
