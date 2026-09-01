// The Model Tree: every element ever placed on any view, browsable and
// organizable into subfolders under its layer (Strategy/Business/
// Application/...), independent of which view(s) it's actually used in —
// mirrors ViewsPanel's own folder tree (viewsPanel.ts) closely, since both
// are now just a path-addressed StorageAdapter tree underneath, and reuse
// the exact same createFolder/rename/deleteFolder primitives.
//
// Used by both the real VS Code sidebar (modelTreeMain.ts, which gives it
// its own VSCodeAdapter so it can manage the tree independent of whether a
// Designer canvas is even open) and the dev-preview harness's embedded dock
// (designer.ts, which can also drop a drag directly onto the canvas since
// they share a page) — see ModelTreeHost below for the seam between them.

import { LayerKey, LAYERS, ModelElementRecord } from './model.js';
import type { StorageAdapter, ModelTreeNode } from './storage/StorageAdapter.js';
import { elementIcon } from './icons.js';
import { PALETTE_GROUPS, humanize } from './paletteData.js';
import { el, codicon } from './domUtil.js';
import { folderGlyph } from './viewsPanel.js';

const FOLDER_ORDER: LayerKey[] = [...new Set(PALETTE_GROUPS.map(g => g.layer))];
const INDENT_PER_DEPTH = 15;
const BASE_INDENT = 6;

export interface ModelTreeHost {
  storage: StorageAdapter;
  /** A plain click (no drag) on an element row — arm canvas placement (embedded: this designer instance directly; hostApi: posts an arm message to the extension host). */
  onPlace(record: ModelElementRecord, e: PointerEvent): void;
  /** A drag ended directly over the canvas — embedded mode only (a real sidebar webview can't drag onto a different webview). */
  onDropOnCanvas?(record: ModelElementRecord, clientX: number, clientY: number): void;
  /** Whether (clientX, clientY) is over the canvas — embedded mode only. */
  isOverCanvas?(clientX: number, clientY: number): boolean;
}

export class ModelTreeController {
  readonly searchInput: HTMLInputElement;
  readonly scroll: HTMLDivElement;
  private host: ModelTreeHost;
  private nodes: ModelTreeNode[] = [];
  /** Explicit user expand/collapse choices, keyed by folder path — until toggled, a folder's shown state just tracks whether it currently has anything in it. */
  private overrides = new Map<string, boolean>();
  private justDragged = false;
  private clickTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(host: ModelTreeHost) {
    this.host = host;
    this.searchInput = el('input', 'am-palette-search');
    this.searchInput.placeholder = 'Filter…';
    this.searchInput.addEventListener('input', () => this.render(this.nodes));
    this.scroll = el('div', 'am-palette-scroll');
  }

  /** Rebuilds the tree from a fresh node list (e.g. after archiModelElementsChanged, or this controller's own writes). */
  render(nodes: ModelTreeNode[]): void {
    this.nodes = nodes;
    this.scroll.innerHTML = '';
    for (const layerKey of FOLDER_ORDER) {
      const label = LAYERS[layerKey].label;
      this.renderFolder(label, label, 0);
    }
  }

  private query(): string {
    return this.searchInput.value.trim().toLowerCase();
  }

  private matchesElement(node: ModelTreeNode & { type: 'element' }): boolean {
    const q = this.query();
    return !q || node.name.toLowerCase().includes(q) || humanize(node.record.type).toLowerCase().includes(q);
  }

  private folderHasMatch(folderPath: string): boolean {
    const q = this.query();
    if (!q) return true;
    return this.nodes
      .filter(n => n.parentPath === folderPath)
      .some(n => (n.type === 'element' ? this.matchesElement(n) : this.folderHasMatch(n.path)));
  }

  private isExpanded(path: string, hasChildren: boolean): boolean {
    if (this.query()) return true;
    return this.overrides.has(path) ? this.overrides.get(path)! : hasChildren;
  }

  private renderFolder(folderPath: string, label: string, depth: number): void {
    const q = this.query();
    if (q && !this.folderHasMatch(folderPath) && depth > 0) return;

    const children = this.nodes.filter(n => n.parentPath === folderPath);
    const childFolders = children
      .filter((n): n is ModelTreeNode & { type: 'folder' } => n.type === 'folder')
      .filter(f => !q || this.folderHasMatch(f.path))
      .sort((a, b) => a.name.localeCompare(b.name));
    const childElements = children
      .filter((n): n is ModelTreeNode & { type: 'element' } => n.type === 'element')
      .filter(e => this.matchesElement(e))
      .sort((a, b) => a.name.localeCompare(b.name));

    const expanded = this.isExpanded(folderPath, children.length > 0);
    const isLayerRoot = depth === 0;

    const row = el('div', 'am-tree-row am-folder-row am-model-tree-folder', { 'data-folder-path': folderPath });
    row.style.paddingLeft = `${BASE_INDENT + depth * INDENT_PER_DEPTH}px`;
    const caret = codicon(expanded ? 'chevron-down' : 'chevron-right', 'am-caret');
    row.appendChild(caret);
    row.appendChild(folderGlyph(expanded));
    const nameEl = el('span', 'am-tree-name');
    nameEl.textContent = label;
    nameEl.title = isLayerRoot ? 'Click to expand/collapse' : 'Click to expand/collapse · double-click to rename';
    row.appendChild(nameEl);
    const addBtn = el('button', 'am-view-delete am-model-tree-add', { title: 'New subfolder here' });
    addBtn.appendChild(codicon('add'));
    addBtn.addEventListener('click', (e) => { e.stopPropagation(); void this.createSubfolder(folderPath); });
    row.appendChild(addBtn);
    if (!isLayerRoot) {
      const delBtn = el('button', 'am-view-delete', { title: 'Delete folder (contents move up a level)' });
      delBtn.appendChild(codicon('close'));
      delBtn.addEventListener('click', (e) => { e.stopPropagation(); void this.deleteFolder(folderPath); });
      row.appendChild(delBtn);
    }
    row.addEventListener('click', () => {
      if (this.justDragged) return;
      clearTimeout(this.clickTimer);
      this.clickTimer = setTimeout(() => {
        this.overrides.set(folderPath, !expanded);
        this.render(this.nodes);
      }, 200);
    });
    if (!isLayerRoot) {
      nameEl.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        clearTimeout(this.clickTimer);
        this.renameInline(folderPath, label, nameEl);
      });
      row.addEventListener('pointerdown', (e) => this.startDrag(e, 'folder', folderPath, label));
    }
    this.scroll.appendChild(row);

    if (!expanded) return;
    for (const cf of childFolders) this.renderFolder(cf.path, cf.name, depth + 1);
    for (const ce of childElements) this.renderElementRow(ce, depth + 1);
    if (childFolders.length === 0 && childElements.length === 0) {
      const empty = el('div', 'am-tree-empty');
      empty.textContent = 'No elements yet';
      empty.style.paddingLeft = `${BASE_INDENT + (depth + 1) * INDENT_PER_DEPTH}px`;
      this.scroll.appendChild(empty);
    }
  }

  private renderElementRow(node: ModelTreeNode & { type: 'element' }, depth: number): void {
    const row = el('div', 'am-tree-row am-model-tree-row', {
      title: `${node.record.name} — drag onto the canvas, or onto a folder to organize it`,
    });
    row.style.paddingLeft = `${BASE_INDENT + depth * INDENT_PER_DEPTH}px`;
    row.appendChild(elementIcon(node.record.type));
    const nameEl = el('span', 'am-tree-name');
    nameEl.textContent = node.name;
    row.appendChild(nameEl);
    row.addEventListener('pointerdown', (e) => this.startDrag(e, 'element', node.path, node.name, node.record));
    this.scroll.appendChild(row);
  }

  // Drags either an element (onto a folder to organize it, or onto the
  // canvas in embedded mode to place it) or a folder (onto another folder
  // to move it) — a plain click that never turns into a drag falls through
  // to host.onPlace for elements, arming canvas placement the click-then-
  // click way (the only way a real sidebar webview can place onto a
  // separate canvas webview at all).
  private startDrag(e: PointerEvent, kind: 'element' | 'folder', path: string, label: string, record?: ModelElementRecord): void {
    if (e.button !== undefined && e.button !== 0) return;
    const startX = e.clientX, startY = e.clientY;
    let dragging = false;
    let ghost: HTMLDivElement | null = null;
    let dropFolderPath: string | null = null;
    let overCanvas = false;
    const clearHover = () => this.scroll.querySelectorAll('.am-drop-hover').forEach(n => n.classList.remove('am-drop-hover'));
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
      if (folderRow && this.scroll.contains(folderRow) && folderRow.dataset.folderPath !== path) {
        folderRow.classList.add('am-drop-hover');
        dropFolderPath = folderRow.dataset.folderPath!;
        overCanvas = false;
      } else {
        dropFolderPath = null;
        overCanvas = this.host.isOverCanvas?.(ev.clientX, ev.clientY) ?? false;
      }
    };
    const up = async (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!dragging) {
        if (kind === 'element' && record) this.host.onPlace(record, e);
        return;
      }
      ghost?.remove();
      clearHover();
      if (dropFolderPath) {
        if (kind === 'element') await this.moveElementToFolder(path, dropFolderPath);
        else await this.moveFolderToFolder(path, dropFolderPath);
      } else if (overCanvas && kind === 'element' && record) {
        this.host.onDropOnCanvas?.(record, ev.clientX, ev.clientY);
      }
      this.justDragged = true;
      setTimeout(() => { this.justDragged = false; }, 0);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  private renameInline(path: string, currentName: string, nameEl: HTMLElement): void {
    const input = el('input', 'am-view-rename-input');
    input.value = currentName;
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    const commit = () => {
      const val = input.value.trim();
      if (val) void this.renameFolder(path, val);
      else this.render(this.nodes);
    };
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
      if (e.key === 'Escape') { input.value = currentName; input.blur(); }
    });
  }

  private isDescendantPath(candidate: string, ancestor: string): boolean {
    return candidate === ancestor || candidate.startsWith(`${ancestor}/`);
  }

  async moveElementToFolder(elementPath: string, targetFolderPath: string): Promise<void> {
    const id = elementPath.slice(elementPath.lastIndexOf('/') + 1);
    const newPath = `${targetFolderPath}/${id}`;
    if (newPath === elementPath) return;
    await this.host.storage.rename(elementPath, newPath);
    await this.refresh();
  }

  async moveFolderToFolder(folderPath: string, targetFolderPath: string): Promise<void> {
    if (folderPath === targetFolderPath) return;
    if (this.isDescendantPath(targetFolderPath, folderPath)) return; // no cycles
    const name = folderPath.slice(folderPath.lastIndexOf('/') + 1);
    const newPath = `${targetFolderPath}/${name}`;
    if (newPath === folderPath) return;
    await this.host.storage.rename(folderPath, newPath);
    const prevExpanded = this.overrides.get(folderPath);
    if (prevExpanded !== undefined) this.overrides.set(newPath, prevExpanded);
    await this.refresh();
  }

  async createSubfolder(parentPath: string): Promise<void> {
    const siblingNames = new Set(
      this.nodes.filter(n => n.parentPath === parentPath && n.type === 'folder').map(n => n.name),
    );
    let finalName = 'New Folder', i = 2;
    while (siblingNames.has(finalName)) finalName = `New Folder ${i++}`;
    await this.host.storage.createFolder(`${parentPath}/${finalName}`);
    this.overrides.set(parentPath, true);
    await this.refresh();
  }

  async renameFolder(path: string, name: string): Promise<void> {
    const finalName = name.replace(/[\\/]/g, '-').trim();
    if (!finalName) return;
    const parentPath = path.slice(0, path.lastIndexOf('/'));
    const newPath = `${parentPath}/${finalName}`;
    if (newPath !== path) {
      await this.host.storage.rename(path, newPath);
      const prevExpanded = this.overrides.get(path);
      if (prevExpanded !== undefined) this.overrides.set(newPath, prevExpanded);
    }
    await this.refresh();
  }

  async deleteFolder(path: string): Promise<void> {
    await this.host.storage.deleteFolder(path);
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    const nodes = await this.host.storage.listModelTree();
    this.render(nodes);
  }
}
