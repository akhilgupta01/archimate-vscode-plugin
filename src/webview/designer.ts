import { ArchimateModel, ArchimateElement, ArchimateRelationship, ELEMENT_TYPES, LAYERS, ElementType, RelationshipType, ModelJSON } from './model.js';
import { Renderer } from './renderer.js';
import { GRID_SIZE } from './snap.js';
import { LocalStorageAdapter } from './storage/LocalStorageAdapter.js';
import type { StorageAdapter, ViewData } from './storage/StorageAdapter.js';
import { humanize } from './paletteData.js';
import { canNest } from './relationshipRules.js';
import { ViewsPanel } from './viewsPanel.js';
import { buildPaletteDom } from './paletteView.js';
import { renderInspectorDom, INSPECTOR_EMPTY_HTML, Selection } from './inspectorView.js';
import { CanvasInteractions } from './canvasInteractions.js';
import { el } from './domUtil.js';
import { SVG_NS } from './svgUtil.js';

interface ContextMenuItem { label: string; action: () => void; disabled?: boolean; }

/** Minimal shape of the object VS Code's acquireVsCodeApi() returns — just enough to post/receive notifications outside the storage RPC channel. */
export interface HostApi { postMessage(message: unknown): void; }

export interface ArchimateDesignerOptions {
  model?: ArchimateModel;
  onSave?: (json: ViewData & { viewPath: string }) => void;
  storageKey?: string;
  /** Path-addressed adapter (see src/webview/storage/*.ts); defaults to LocalStorageAdapter. */
  storage?: StorageAdapter;
  /**
   * When set, the designer assumes a separate host-provided palette (the VS
   * Code sidebar view) is arming tools via postMessage, so it skips building
   * its own embedded palette panel and instead listens for `archiToolArm`
   * messages, echoing armed/cleared state back via `archiToolArmedChanged`
   * so the sidebar can keep its own highlight in sync. Omit to keep the
   * classic embedded drag-and-drop palette (used by the dev-preview harness,
   * where there is no separate VS Code sidebar to drive it).
   */
  hostApi?: HostApi | null;
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
  armedElementType: ElementType | null = null;
  pendingSource: string | null = null;
  currentViewPath: string | null = null;
  paletteCollapsed = false;
  externalFileUri: string | null = null;
  renderer!: Renderer;

  private interactions!: CanvasInteractions;

  // DOM refs, assigned during _buildDom()
  private viewsPanelCtrl!: ViewsPanel;
  private rightDock?: HTMLDivElement;
  private palette?: HTMLDivElement;
  private inspector?: HTMLDivElement;
  private canvasWrap!: HTMLDivElement;
  private svg!: SVGSVGElement;
  statusEl!: HTMLDivElement;
  private zoomLabel!: HTMLSpanElement;
  private paletteScroll?: HTMLDivElement;

  private hostApi: HostApi | null = null;
  private embeddedPalette = true;
  private spaceDown = false;
  private ctrlDown = false;
  private changeTimer: ReturnType<typeof setTimeout> | undefined;
  private statusTimer: ReturnType<typeof setTimeout> | undefined;
  private contextMenu: HTMLDivElement | null = null;

  constructor(container: HTMLElement, opts: ArchimateDesignerOptions = {}) {
    this.container = container;
    this.model = opts.model || new ArchimateModel();
    this.onSave = opts.onSave || null;
    this.storageKey = opts.storageKey || 'archimate-designer';
    this.storage = opts.storage || new LocalStorageAdapter({ storageKey: this.storageKey });
    this.hostApi = opts.hostApi ?? null;
    this.embeddedPalette = !this.hostApi;

    this._buildDom();
    this.interactions = new CanvasInteractions(this);
    this.renderer = new Renderer(this.svg, this.model, {
      onElementPointerDown: (e, id) => this.interactions.onElementPointerDown(e, id),
      onEdgeClick: (e, id) => this.interactions.onEdgeClick(e, id),
      onHingePointerDown: (e, relId, end) => this.interactions.onHingePointerDown(e, relId, end),
      onResizeHandlePointerDown: (e, elId, handle) => this.interactions.onResizeHandlePointerDown(e, elId, handle),
      onSegmentPointerDown: (e, relId, segIndex) => this.interactions.onSegmentPointerDown(e, relId, segIndex),
    });
    this._wireCanvasEvents();
    if (this.hostApi) {
      window.addEventListener('message', (ev: MessageEvent) => {
        const d = ev.data;
        if (!d) return;
        if (d.type === 'archiToolArm') this._armTool(d.kind, d.archiType);
        else if (d.type === 'archiInspectorEdit') this._applyInspectorEdit(d.id, d.field, d.value, d.final);
        else if (d.type === 'archiInspectorReroute') this._applyInspectorReroute(d.id);
      });
    }
    this.renderer.fullRender();
    this._applyTransform();
    this.viewsPanelCtrl.renderList();
  }

  // ================= DOM scaffold =================
  private _buildDom(): void {
    this.container.classList.add('am-designer');
    this.container.innerHTML = '';

    this.viewsPanelCtrl = new ViewsPanel(this);

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

    // In hostApi mode both the palette and inspector live in their own VS
    // Code sidebar views (see paletteMain.ts / inspectorMain.ts), so there's
    // nothing left to dock here — skip it entirely and let the canvas take
    // the full width instead of reserving space for an empty dock.
    if (this.embeddedPalette) {
      this.rightDock = el('div', 'am-right-dock');
      this._buildRightDock();
    }

    // this.container.appendChild(this.viewsPanel); // Views panel removed
    this.container.appendChild(main);
    if (this.rightDock) this.container.appendChild(this.rightDock);
  }

  // ---------------- Views panel (left) ----------------
  // The panel itself (folder tree, CRUD, drag-to-move, rename-inline) lives
  // in ViewsPanel (viewsPanel.ts); these just forward the calls that were
  // previously public API on this class, so any external caller (e.g. the
  // dev-preview harness's `window.designer` console access) keeps working.
  createFolder(name = 'New Folder', parentPath: string | null = null): Promise<string> {
    return this.viewsPanelCtrl.createFolder(name, parentPath);
  }
  renameFolder(path: string, name: string): Promise<void> {
    return this.viewsPanelCtrl.renameFolder(path, name);
  }
  deleteFolder(path: string): Promise<void> {
    return this.viewsPanelCtrl.deleteFolder(path);
  }
  moveViewToFolder(viewPath: string, folderPath: string | null): Promise<void> {
    return this.viewsPanelCtrl.moveViewToFolder(viewPath, folderPath);
  }
  moveFolderToFolder(folderPath: string, targetParentPath: string | null): Promise<void> {
    return this.viewsPanelCtrl.moveFolderToFolder(folderPath, targetParentPath);
  }
  newView(): void {
    this.viewsPanelCtrl.newView();
  }
  loadView(path: string): Promise<boolean> {
    return this.viewsPanelCtrl.loadView(path);
  }
  renameView(path: string, name: string): Promise<void> {
    return this.viewsPanelCtrl.renameView(path, name);
  }
  deleteView(path: string): Promise<void> {
    return this.viewsPanelCtrl.deleteView(path);
  }

  // ---------------- Right dock: embedded-mode-only palette + inspector ----------------
  // (In hostApi mode both live in their own VS Code sidebar views instead —
  // see _buildDom — so this whole method is only ever called in embedded/
  // dev-preview mode, where this.rightDock is always set right before the call.)
  private _buildRightDock(): void {
    const rightDock = this.rightDock!;
    rightDock.innerHTML = '';
    const collapsedTab = el('button', 'am-dock-collapsed-tab', { title: 'Show palette' });
    collapsedTab.innerHTML = '<span>◂ Palette</span>';
    collapsedTab.addEventListener('click', () => this._setPaletteCollapsed(false));

    const dockContent = el('div', 'am-dock-content');
    this.palette = el('div', 'am-palette');
    this._buildPalette();
    dockContent.appendChild(this.palette);
    this.inspector = el('div', 'am-inspector');
    this._buildInspector();
    dockContent.appendChild(this.inspector);

    rightDock.appendChild(collapsedTab);
    rightDock.appendChild(dockContent);
    this._setPaletteCollapsed(false);
  }

  private _setPaletteCollapsed(collapsed: boolean): void {
    this.paletteCollapsed = collapsed;
    this.rightDock?.classList.toggle('am-collapsed', collapsed);
  }

  private _buildPalette(): void {
    const palette = this.palette!;
    palette.innerHTML = '';
    const header = el('div', 'am-panel-header');
    header.textContent = 'Palette';
    const collapseBtn = el('button', 'am-collapse-btn', { title: 'Collapse palette' });
    collapseBtn.textContent = '▸';
    collapseBtn.addEventListener('click', () => this._setPaletteCollapsed(true));
    header.appendChild(collapseBtn);
    palette.appendChild(header);

    const { searchInput, scroll, elementButtons, relButtons } = buildPaletteDom();
    palette.appendChild(searchInput);
    palette.appendChild(scroll);
    this.paletteScroll = scroll;

    for (const [type, btn] of relButtons) btn.addEventListener('click', () => this._setRelationshipTool(type, btn));
    for (const [type, btn] of elementButtons) btn.addEventListener('pointerdown', (e) => this._startPaletteDrag(e, type));
  }

  private _buildToolbar(toolbar: HTMLDivElement): void {
    const status = el('div', 'am-status');
    status.textContent = this.embeddedPalette
      ? 'Drag elements from the palette onto the canvas.'
      : 'Select a tool from the Palette view, then click the canvas.';
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
    this.inspector!.innerHTML = INSPECTOR_EMPTY_HTML;
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
  _clientToWorld(cx: number, cy: number): { x: number; y: number } {
    const r = this.svg.getBoundingClientRect();
    return { x: (cx - r.left - this.pan.x) / this.zoom, y: (cy - r.top - this.pan.y) / this.zoom };
  }

  // ================= relationship tool =================
  private _setRelationshipTool(type: RelationshipType, itemEl: HTMLElement): void {
    const already = this.activeRelType === type;
    this.paletteScroll?.querySelectorAll('.am-icon-btn-rel').forEach(i => i.classList.remove('am-active'));
    this.activeRelType = already ? null : type;
    this.armedElementType = null;
    this.pendingSource = null;
    if (this.activeRelType) itemEl.classList.add('am-active');
    this._updateArmedStatus();
    this._notifyToolArmed();
  }

  // ================= tool arming from an external host (VS Code sidebar palette) =================
  // Mirrors _setRelationshipTool/_startPaletteDrag for the case where the
  // palette lives in a separate WebviewView and can't drag-and-drop onto
  // this webview's canvas (VS Code webviews are isolated contexts), so it
  // arms a tool by message instead; placing an element then happens on the
  // next plain click on empty canvas (see _wireCanvasEvents).
  private _armTool(kind: 'element' | 'relationship', archiType: string): void {
    this.pendingSource = null;
    if (kind === 'relationship') {
      const type = archiType as RelationshipType;
      this.activeRelType = this.activeRelType === type ? null : type;
      this.armedElementType = null;
    } else {
      const type = archiType as ElementType;
      this.armedElementType = this.armedElementType === type ? null : type;
      this.activeRelType = null;
    }
    this._updateArmedStatus();
    this._notifyToolArmed();
  }

  /** Clears whatever tool is currently armed (relationship or element), embedded or host-driven. */
  _cancelActiveTool(): void {
    this.activeRelType = null;
    this.pendingSource = null;
    this.armedElementType = null;
    this.paletteScroll?.querySelectorAll('.am-icon-btn-rel').forEach(i => i.classList.remove('am-active'));
    this._updateArmedStatus();
    this._notifyToolArmed();
  }

  private _updateArmedStatus(): void {
    this.svg.classList.toggle('am-place-cursor', !!this.armedElementType);
    if (this.activeRelType) {
      this.statusEl.textContent = `Click a source element, then a target element to draw a ${humanize(this.activeRelType)} relationship. Esc to cancel.`;
    } else if (this.armedElementType) {
      this.statusEl.textContent = `Click on the canvas to place a ${humanize(this.armedElementType)}. Esc to cancel.`;
    } else {
      this.statusEl.textContent = this.embeddedPalette
        ? 'Drag elements from the palette onto the canvas.'
        : 'Select a tool from the Palette view, then click the canvas.';
    }
  }

  /** Tells the host (VS Code extension, relaying to the sidebar palette view) what's armed now, so its highlight stays in sync. Harmless no-op in embedded mode (no host). */
  private _notifyToolArmed(): void {
    this.hostApi?.postMessage({
      type: 'archiToolArmedChanged',
      kind: this.activeRelType ? 'relationship' : this.armedElementType ? 'element' : null,
      archiType: this.activeRelType || this.armedElementType || null,
    });
  }

  // Element/edge drag, resize, and nesting interactions live in
  // CanvasInteractions (canvasInteractions.ts) — see `this.interactions`,
  // constructed in the constructor and wired to the renderer's pointer
  // callbacks.
  _setSelection(idSet: Set<string>): void {
    this.selected = idSet;
    this.renderer.setSelected(idSet);
    if (this.inspector) this._renderInspector();
    if (this.hostApi) this._notifySelectionChanged();
  }

  private _renderInspector(): void {
    renderInspectorDom(this.inspector!, this._currentSelection(), {
      onEdit: (id, field, value, final) => this._applyInspectorEdit(id, field, value, final),
      onReroute: (id) => this._applyInspectorReroute(id),
    });
  }

  private _rerouteRelationship(relModel: ArchimateRelationship): void {
    relModel.bendpoints = null;
    relModel.sourcePort = null;
    relModel.targetPort = null;
    this.renderer.renderEdge(relModel);
    this._afterModelChange();
  }

  /** The current selection, shaped for InspectorDom/archiSelectionChanged — null unless exactly one element or relationship is selected. */
  private _currentSelection(): Selection {
    if (this.selected.size !== 1) return null;
    const id = [...this.selected][0];
    const elModel = this.model.getElement(id);
    const relModel = this.model.relationships.get(id);
    if (elModel) return { kind: 'element', id, type: elModel.type, name: elModel.name, documentation: elModel.documentation || '' };
    if (relModel) return { kind: 'relationship', id, type: relModel.type, name: relModel.name || '' };
    return null;
  }

  // ================= inspector sync with an external host (VS Code sidebar Inspector) =================
  // Mirrors the palette's hostApi relay: the Inspector lives in its own
  // WebviewView and can't read this.model directly, so the extension host
  // relays the current selection over to it, and relays its edits back.
  private _notifySelectionChanged(): void {
    this.hostApi?.postMessage({ type: 'archiSelectionChanged', selection: this._currentSelection() });
  }

  private _applyInspectorEdit(id: string, field: string, value: string, final: boolean): void {
    const elModel = this.model.getElement(id);
    const relModel = this.model.relationships.get(id);
    if (elModel && field === 'name') { elModel.name = value; this.renderer.updateElementLabel(elModel); }
    else if (elModel && field === 'documentation') { elModel.documentation = value; }
    else if (relModel && field === 'name') { relModel.name = value; this.renderer.renderEdge(relModel); }
    if (final) this._afterModelChange();
  }

  private _applyInspectorReroute(id: string): void {
    const relModel = this.model.relationships.get(id);
    if (relModel) this._rerouteRelationship(relModel);
  }

  // ================= canvas-level events =================
  private _wireCanvasEvents(): void {
    this.svg.addEventListener('pointerdown', (e) => {
      if (e.target === this.svg || (e.target as Element).classList?.contains('am-viewport')) {
        if (this.armedElementType) {
          const type = this.armedElementType;
          const pt = this._clientToWorld(e.clientX, e.clientY);
          this._cancelActiveTool();
          this.addElement(type, pt.x - 70, pt.y - 27);
          return;
        }
        if (this.activeRelType) {
          this._cancelActiveTool();
          return;
        }
        if (e.button === 1 || this.spaceDown || e.ctrlKey) { e.preventDefault(); this._startPan(e); return; }
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
      // On macOS, Control-click is translated into a right-click by the OS,
      // so Ctrl+drag-to-pan also fires this event — ctrlKey here means it's
      // that translation, not a genuine right-click, so skip the menu.
      if (e.ctrlKey) return;
      this._showContextMenu(e.clientX, e.clientY, [
        { label: 'Select All', action: () => this.selectAll() },
        { label: 'Deselect All', action: () => this._setSelection(new Set()), disabled: !this.selected.size },
        { label: 'Delete Selected', action: () => this.deleteSelected(), disabled: !this.selected.size },
      ]);
    });
    window.addEventListener('keydown', (e) => {
      const typing = ['INPUT', 'TEXTAREA'].includes((document.activeElement as HTMLElement)?.tagName);
      if (e.code === 'Space' && !typing && !this.spaceDown) { this.spaceDown = true; this._updatePanCursor(); }
      if (e.key === 'Control' && !typing && !this.ctrlDown) { this.ctrlDown = true; this._updatePanCursor(); }
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
        this._cancelActiveTool();
        this._closeContextMenu();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') { this.spaceDown = false; this._updatePanCursor(); }
      if (e.key === 'Control') { this.ctrlDown = false; this._updatePanCursor(); }
    });
    // If the window loses focus (e.g. Cmd-Tab) while a modifier is held,
    // there's no keyup to catch it — drop the stuck pan-cursor state.
    window.addEventListener('blur', () => {
      this.spaceDown = false;
      this.ctrlDown = false;
      this._updatePanCursor();
    });
  }

  private _updatePanCursor(): void {
    this.svg.classList.toggle('am-pan-cursor', this.spaceDown || this.ctrlDown);
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
    if (canNest(type)) {
      const target = this.interactions.hitTestContainerFor(elObj.id, elObj.x + elObj.w / 2, elObj.y + elObj.h / 2, new Set());
      if (target) {
        this.interactions.nestChild(target, elObj);
        this.interactions.offerNestingRelationships([{ parent: target, child: elObj }]);
      }
    }
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

  _afterModelChange(): void {
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
      const tree = await this.viewsPanelCtrl.loadTree();
      const rootViewNames = new Set(tree.filter(e => e.type === 'view' && !e.parentPath).map(e => e.name));
      path = this.viewsPanelCtrl.uniqueName('View', rootViewNames);
    }
    await this.storage.writeView(path, json);
    this.currentViewPath = path;
    if (this.onSave) this.onSave({ ...json, viewPath: path });
    await this.viewsPanelCtrl.renderList();
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
        this.viewsPanelCtrl.renderList();
        this._flashStatus('Imported. Click Save to add it to your views.');
      } catch (err) { this._flashStatus('Import failed: ' + (err as Error).message); }
    };
    reader.readAsText(file);
    (e.target as HTMLInputElement).value = '';
  }

  _flashStatus(msg: string): void {
    this.statusEl.textContent = msg;
    clearTimeout(this.statusTimer);
    this.statusTimer = setTimeout(() => this._updateArmedStatus(), 2400);
  }
}
