import { ArchimateModel, ArchimateElement, ArchimateRelationship, ELEMENT_TYPES, LAYERS, ElementType, RelationshipType, ModelJSON, AppearanceSnapshot, captureAppearance, applyAppearance, ModelElementRecord, captureModelElementRecord } from './model.js';
import { Renderer } from './renderer.js';
import { GRID_SIZE } from './snap.js';
import { LocalStorageAdapter } from './storage/LocalStorageAdapter.js';
import type { StorageAdapter, ViewData } from './storage/StorageAdapter.js';
import { humanize } from './paletteData.js';
import { canNest } from './relationshipRules.js';
import { ViewsPanel } from './viewsPanel.js';
import { buildPaletteDom } from './paletteView.js';
import { ModelTreeController } from './modelTreeView.js';
import { renderInspectorDom, INSPECTOR_EMPTY_HTML, Selection, isAppearanceField, AppearanceField } from './inspectorView.js';
import { CanvasInteractions } from './canvasInteractions.js';
import { el, codicon } from './domUtil.js';
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
  /** Set by the Format Painter toolbar button: the appearance captured from whichever element was selected when it was clicked, waiting for a target element click to apply to. */
  formatPainterAppearance: AppearanceSnapshot | null = null;
  /** Set by clicking/dragging a Model Tree sidebar row: the existing element record waiting for a canvas click (or drop, embedded mode) to place it into this view. */
  armedModelElement: ModelElementRecord | null = null;
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
  private formatPainterBtn?: HTMLButtonElement;
  private gridBtn?: HTMLButtonElement;
  private showGrid = true;
  private modelTreePanel?: HTMLDivElement;
  private modelTreeController?: ModelTreeController;

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
    this.showGrid = localStorage.getItem(`${this.storageKey}:show-grid`) !== 'false';
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
        else if (d.type === 'archiInspectorReset') this._resetAppearance(d.id);
        else if (d.type === 'archiModelElementArm') this._armModelElement(d.record);
        else if (d.type === 'archiExternalStorageChange') this._refreshExternalStorage();
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
    this.canvasWrap.classList.toggle('am-grid-hidden', !this.showGrid);

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
    this.modelTreePanel = el('div', 'am-palette am-model-tree-panel');
    this._buildModelTreePanel();
    dockContent.appendChild(this.modelTreePanel);
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
    collapseBtn.appendChild(codicon('chevron-right'));
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

  // Embedded-mode-only counterpart to the real VS Code Model Tree sidebar
  // (modelTreeMain.ts) — same controller class, but since this lives on the
  // same page as the canvas it can also drop a drag directly onto it
  // (onDropOnCanvas/isOverCanvas below), not just arm-then-click.
  private _buildModelTreePanel(): void {
    const panel = this.modelTreePanel!;
    panel.innerHTML = '';
    const header = el('div', 'am-panel-header');
    header.textContent = 'Model Tree';
    panel.appendChild(header);

    const controller = new ModelTreeController({
      storage: this.storage,
      onPlace: (record) => this._armModelElement(record),
      onDropOnCanvas: (record, clientX, clientY) => {
        const pt = this._clientToWorld(clientX, clientY);
        this._placeModelElement(record, pt.x - 70, pt.y - 27);
      },
      isOverCanvas: (clientX, clientY) => this._pointInCanvas(clientX, clientY),
    });
    panel.appendChild(controller.searchInput);
    panel.appendChild(controller.scroll);
    this.modelTreeController = controller;
    this._refreshEmbeddedModelTree();
  }

  /** Re-reads the Model Tree from storage and redraws the embedded panel — call after any write (see _syncModelElement). No-op in hostApi mode (the real sidebar reads independently via the extension host). */
  private _refreshEmbeddedModelTree(): void {
    if (!this.modelTreeController) return;
    this.storage.listModelTree().then(nodes => this.modelTreeController?.render(nodes)).catch(() => { /* best-effort */ });
  }

  /** The extension host detected a filesystem change it didn't cause itself (e.g. a folder renamed in VS Code's own Explorer) — re-read both on-disk trees this webview shows, since neither refreshes on its own for changes made outside the app. hostApi-only: dev-preview's LocalStorageAdapter has no external writer to race against. */
  private _refreshExternalStorage(): void {
    void this.viewsPanelCtrl.renderList();
    this._refreshEmbeddedModelTree();
  }

  private _buildToolbar(toolbar: HTMLDivElement): void {
    const status = el('div', 'am-status');
    status.textContent = this.embeddedPalette
      ? 'Drag elements from the palette onto the canvas.'
      : 'Select a tool from the Palette view, then click the canvas.';
    this.statusEl = status;
    const spacer = el('div', 'am-toolbar-spacer');
    const zoomOut = el('button', 'am-btn', { title: 'Zoom out' }); zoomOut.appendChild(codicon('zoom-out'));
    zoomOut.addEventListener('click', () => this.setZoom(this.zoom * 0.85));
    const zoomLabel = el('span', 'am-zoom-label'); zoomLabel.textContent = '100%';
    this.zoomLabel = zoomLabel;
    const zoomIn = el('button', 'am-btn', { title: 'Zoom in' }); zoomIn.appendChild(codicon('zoom-in'));
    zoomIn.addEventListener('click', () => this.setZoom(this.zoom * 1.15));
    const zoomReset = el('button', 'am-btn', { title: 'Reset zoom' }); zoomReset.appendChild(codicon('refresh'));
    zoomReset.addEventListener('click', () => this.resetView());
    const gridBtn = el('button', 'am-btn', { title: 'Toggle grid lines' }); gridBtn.appendChild(codicon('symbol-ruler'));
    gridBtn.classList.toggle('am-active', this.showGrid);
    gridBtn.addEventListener('click', () => this._toggleGrid());
    this.gridBtn = gridBtn;
    const formatPainter = el('button', 'am-btn', { title: 'Format Painter: select an element, click this, then click another element to copy its Appearance (colours, line style, font) onto it' });
    formatPainter.appendChild(codicon('paintcan'));
    formatPainter.addEventListener('click', () => this._toggleFormatPainter());
    this.formatPainterBtn = formatPainter;
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

    toolbar.append(status, spacer, zoomOut, zoomLabel, zoomIn, zoomReset, gridBtn, formatPainter, del, importBtn, importInput, exportBtn, saveBtn);
  }

  private _toggleGrid(): void {
    this.showGrid = !this.showGrid;
    this.canvasWrap.classList.toggle('am-grid-hidden', !this.showGrid);
    this.gridBtn?.classList.toggle('am-active', this.showGrid);
    localStorage.setItem(`${this.storageKey}:show-grid`, String(this.showGrid));
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

  // ================= Model Tree placement =================
  // The Model Tree panel/sidebar owns its own drag interactions (see
  // ModelTreeController in modelTreeView.ts) — this just applies the result,
  // reusing addElement's existing id-collision guard so dropping something
  // already in this view selects it instead of duplicating it.
  private _placeModelElement(record: ModelElementRecord, x: number, y: number): void {
    this.addElement(record.type, x, y, { id: record.id, name: record.name, documentation: record.documentation });
  }

  // Mirrors _armTool for the case where the Model Tree lives in its own
  // VS Code sidebar view and can't drag-and-drop onto this webview's
  // canvas — arms placement by message instead; placing then happens on
  // the next plain click on empty canvas (see _wireCanvasEvents).
  private _armModelElement(record: ModelElementRecord): void {
    this.activeRelType = null;
    this.armedElementType = null;
    this.pendingSource = null;
    this.formatPainterAppearance = null;
    this.paletteScroll?.querySelectorAll('.am-icon-btn-rel').forEach(i => i.classList.remove('am-active'));
    this.formatPainterBtn?.classList.remove('am-active');
    this.armedModelElement = this.armedModelElement?.id === record.id ? null : record;
    this._updateArmedStatus();
    this._notifyToolArmed();
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

  /** Clears whatever tool is currently armed (relationship, element, Format Painter, or a Model Tree placement), embedded or host-driven. */
  _cancelActiveTool(): void {
    this.activeRelType = null;
    this.pendingSource = null;
    this.armedElementType = null;
    this.formatPainterAppearance = null;
    this.armedModelElement = null;
    this.paletteScroll?.querySelectorAll('.am-icon-btn-rel').forEach(i => i.classList.remove('am-active'));
    this.formatPainterBtn?.classList.remove('am-active');
    this.svg.classList.remove('am-paint-cursor');
    this._updateArmedStatus();
    this._notifyToolArmed();
  }

  private _updateArmedStatus(): void {
    this.svg.classList.toggle('am-place-cursor', !!this.armedElementType || !!this.armedModelElement);
    if (this.activeRelType) {
      this.statusEl.textContent = `Click a source element, then a target element to draw a ${humanize(this.activeRelType)} relationship. Esc to cancel.`;
    } else if (this.armedElementType) {
      this.statusEl.textContent = `Click on the canvas to place a ${humanize(this.armedElementType)}. Esc to cancel.`;
    } else if (this.formatPainterAppearance) {
      this.statusEl.textContent = 'Format Painter armed — click another element to copy the appearance onto it. Esc to cancel.';
    } else if (this.armedModelElement) {
      this.statusEl.textContent = `Click on the canvas to place "${this.armedModelElement.name}". Esc to cancel.`;
    } else {
      this.statusEl.textContent = this.embeddedPalette
        ? 'Drag elements from the palette onto the canvas.'
        : 'Select a tool from the Palette view, then click the canvas.';
    }
  }

  // ================= format painter =================
  // Mirrors Word/PowerPoint's format painter: capture the Appearance of
  // whichever single element is selected right now, then apply it to the
  // next element clicked (see CanvasInteractions.onElementPointerDown).
  // Single-use — applying (or Esc, or an empty-canvas click) disarms it,
  // same as the relationship-drawing tool.
  private _toggleFormatPainter(): void {
    if (this.formatPainterAppearance) { this._cancelActiveTool(); return; }
    if (this.selected.size !== 1) {
      this._flashStatus('Select a single element first, then click Format Painter.');
      return;
    }
    const elModel = this.model.getElement([...this.selected][0]);
    if (!elModel) {
      this._flashStatus('Select an element (not a relationship) first, then click Format Painter.');
      return;
    }
    this.activeRelType = null;
    this.armedElementType = null;
    this.pendingSource = null;
    this.paletteScroll?.querySelectorAll('.am-icon-btn-rel').forEach(i => i.classList.remove('am-active'));
    this.formatPainterAppearance = captureAppearance(elModel);
    this.formatPainterBtn?.classList.add('am-active');
    this.svg.classList.add('am-paint-cursor');
    this._updateArmedStatus();
    this._notifyToolArmed();
  }

  /** Applies the captured Format Painter appearance onto `targetId` and disarms the tool. */
  _applyFormatPainter(targetId: string): void {
    const snap = this.formatPainterAppearance;
    if (!snap) return;
    const targetEl = this.model.getElement(targetId);
    this._cancelActiveTool();
    if (!targetEl) return;
    applyAppearance(targetEl, snap);
    this.renderer.updateElementGeometry(targetEl);
    this._setSelection(new Set([targetId]));
    this._afterModelChange();
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
      onResetAppearance: (id) => this._resetAppearance(id),
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
    if (elModel) {
      const layer = LAYERS[ELEMENT_TYPES[elModel.type].layer];
      return {
        kind: 'element', id, type: elModel.type, name: elModel.name, documentation: elModel.documentation || '',
        fillColor: elModel.fillColor, fillOpacity: elModel.fillOpacity,
        lineColor: elModel.lineColor, lineOpacity: elModel.lineOpacity,
        lineWidth: elModel.lineWidth, lineStyle: elModel.lineStyle,
        fontColor: elModel.fontColor, fontFamily: elModel.fontFamily, fontSize: elModel.fontSize,
        textAlign: elModel.textAlign, verticalAlign: elModel.verticalAlign,
        defaultFillColor: layer.color, defaultLineColor: layer.stroke,
      };
    }
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
    else if (elModel && isAppearanceField(field)) { this._applyAppearanceEdit(elModel, field, value); }
    else if (relModel && field === 'name') { relModel.name = value; this.renderer.renderEdge(relModel); }
    // Name/documentation are the Model Tree's shared fields (see model.ts) —
    // write the change through on commit so it's what every *other* view
    // sees the next time it loads this same element.
    if (elModel && final && (field === 'name' || field === 'documentation')) this._syncModelElement(elModel);
    if (final) this._afterModelChange();
  }

  private _applyAppearanceEdit(elModel: ArchimateElement, field: AppearanceField, value: string): void {
    switch (field) {
      case 'fillColor': elModel.fillColor = value || null; break;
      case 'lineColor': elModel.lineColor = value || null; break;
      case 'fontColor': elModel.fontColor = value || null; break;
      case 'fontFamily': elModel.fontFamily = value || null; break;
      case 'fillOpacity': elModel.fillOpacity = value === '' ? null : Math.min(255, Math.max(0, Number(value))); break;
      case 'lineOpacity': elModel.lineOpacity = value === '' ? null : Math.min(255, Math.max(0, Number(value))); break;
      case 'fontSize': elModel.fontSize = value === '' ? null : Math.max(6, Number(value)); break;
      case 'lineWidth': elModel.lineWidth = (value || null) as ArchimateElement['lineWidth']; break;
      case 'lineStyle': elModel.lineStyle = (value || null) as ArchimateElement['lineStyle']; break;
      case 'textAlign': elModel.textAlign = (value || null) as ArchimateElement['textAlign']; break;
      case 'verticalAlign': elModel.verticalAlign = (value || null) as ArchimateElement['verticalAlign']; break;
    }
    this.renderer.updateElementGeometry(elModel);
  }

  private _resetAppearance(id: string): void {
    const elModel = this.model.getElement(id);
    if (!elModel) return;
    elModel.fillColor = null;
    elModel.fillOpacity = null;
    elModel.lineColor = null;
    elModel.lineOpacity = null;
    elModel.lineWidth = null;
    elModel.lineStyle = null;
    elModel.fontColor = null;
    elModel.fontFamily = null;
    elModel.fontSize = null;
    elModel.textAlign = null;
    elModel.verticalAlign = null;
    this.renderer.updateElementGeometry(elModel);
    // Several fields changed at once, so re-render the whole panel (like a
    // fresh selection) rather than trying to patch each control in place.
    if (this.inspector) this._renderInspector();
    if (this.hostApi) this._notifySelectionChanged();
    this._afterModelChange();
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
        if (this.armedModelElement) {
          const record = this.armedModelElement;
          const pt = this._clientToWorld(e.clientX, e.clientY);
          this._cancelActiveTool();
          this._placeModelElement(record, pt.x - 70, pt.y - 27);
          return;
        }
        if (this.activeRelType || this.formatPainterAppearance) {
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
  addElement(type: ElementType, x: number, y: number, opts: { name?: string; id?: string; documentation?: string } = {}): ArchimateElement {
    // A specific id is only ever passed when placing an existing Model Tree
    // record (see _placeModelElement) — if it's already in this view,
    // creating a second local element with the same id would silently
    // clobber whichever one the Map ends up keeping, so just point at the
    // one already here instead.
    if (opts.id && this.model.elements.has(opts.id)) {
      const existing = this.model.getElement(opts.id)!;
      this._setSelection(new Set([opts.id]));
      this._flashStatus(`"${existing.name}" is already in this view.`);
      return existing;
    }
    const elObj = this.model.addElement({ type, x, y, name: opts.name || humanize(type), id: opts.id, documentation: opts.documentation || '' });
    this.renderer.renderElement(elObj);
    if (canNest(type)) {
      const target = this.interactions.hitTestContainerFor(elObj.id, elObj.x + elObj.w / 2, elObj.y + elObj.h / 2, new Set());
      if (target) {
        this.interactions.nestChild(target, elObj);
        this.interactions.offerNestingRelationships([{ parent: target, child: elObj }]);
      }
    }
    this._syncModelElement(elObj);
    this._afterModelChange();
    return elObj;
  }

  /** Write-through to this element's shared Model Tree record (id/type/name/documentation only — see ModelElementRecord) so it's browsable/reusable from the Model Tree sidebar. Best-effort: a failure here shouldn't block the view's own save. */
  private _syncModelElement(elObj: ArchimateElement): void {
    this.storage.writeModelElement(captureModelElementRecord(elObj))
      .then(() => this._refreshEmbeddedModelTree())
      .catch(() => { /* best-effort */ });
  }

  addRelationship(type: RelationshipType, sourceId: string, targetId: string, opts: { name?: string } = {}): ArchimateRelationship {
    const rel = this.model.addRelationship({ type, source: sourceId, target: targetId, name: opts.name || '' });
    this.renderer.renderEdge(rel);
    this._afterModelChange();
    return rel;
  }

  deleteSelected(): void {
    if (!this.selected.size) return;
    // Deleting a container's last child should un-stick that container's
    // label from the top-center spot it auto-moved to while it had one
    // (see renderer.ts's _paintElement) — capture parents before removal,
    // repaint whichever ones are still around afterward.
    const formerParentIds = new Set(
      [...this.selected]
        .map(id => this.model.getElement(id)?.parentId)
        .filter((id): id is string => !!id),
    );
    for (const id of this.selected) {
      if (this.model.elements.has(id)) { this.model.removeElement(id); this.renderer.removeElementDom(id); }
      if (this.model.relationships.has(id)) { this.model.removeRelationship(id); this.renderer.removeEdgeDom(id); }
    }
    for (const [id] of [...this.renderer.edgeDom]) {
      if (!this.model.relationships.has(id)) this.renderer.removeEdgeDom(id);
    }
    for (const parentId of formerParentIds) {
      const parent = this.model.getElement(parentId);
      if (parent) this.renderer.updateElementGeometry(parent);
    }
    this._setSelection(new Set());
    this.renderer.rerouteAll();
    this._afterModelChange();
  }

  /** Called after every model edit; debounces an actual save so the canvas is always persisted without the user needing to click Save themselves. */
  _afterModelChange(): void {
    if (this.changeTimer) clearTimeout(this.changeTimer);
    this.changeTimer = setTimeout(() => {
      this.save().catch(err => this._flashStatus('Autosave failed: ' + (err as Error).message));
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
    this._refreshFromModelTree();
  }

  // Re-syncs name/documentation for every element in this view against its
  // shared Model Tree record (see model.ts's ModelElementRecord) — those two
  // fields are meant to behave like a live reference, so if this element
  // was renamed from a *different* view since this view was last saved,
  // this is what catches this view up on open.
  private _refreshFromModelTree(): void {
    this.storage.listModelTree().then(nodes => {
      const records = nodes.filter((n): n is typeof n & { type: 'element' } => n.type === 'element').map(n => n.record);
      if (!records.length) return;
      const byId = new Map(records.map(r => [r.id, r]));
      let changed = false;
      for (const elObj of this.model.elements.values()) {
        const record = byId.get(elObj.id);
        if (!record) continue;
        if (elObj.name !== record.name) { elObj.name = record.name; this.renderer.updateElementLabel(elObj); changed = true; }
        if (elObj.documentation !== record.documentation) { elObj.documentation = record.documentation; changed = true; }
      }
      if (changed) {
        this._afterModelChange();
        if (this.inspector) this._renderInspector();
      }
    }).catch(() => { /* best-effort */ });
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
