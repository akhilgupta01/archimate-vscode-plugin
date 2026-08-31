// Element/edge drag, resize, and container-nesting interactions — the
// canvas's actual pointer-driven editing logic. Extracted out of
// ArchimateDesigner, which owns the model/renderer/selection this class
// needs to read and mutate (see `CanvasInteractionsHost` below) and which
// still owns everything NOT in here: pan/zoom/marquee/keyboard/context-menu,
// tool arming, import/export/save. Not unit-testable headlessly (it reaches
// into `window`/`document` throughout for drag listeners and the nesting
// dialog), so this is verified by hand in the browser instead.

import { ArchimateElement, ArchimateModel, ArchimateRelationship, RelationshipType } from './model.js';
import type { Renderer } from './renderer.js';
import { computeMoveSnap, computeResizedBox, enforceMinSize, computeResizeSnap, ResizeHandle, GRID_SIZE } from './snap.js';
import { snappedPerimeterPoint, nearestPerimeterPoint, simplifyCollinear } from './router.js';
import { humanize } from './paletteData.js';
import { legalNestingRelationships, canNest, NestingRelationOption } from './relationshipRules.js';
import { el } from './domUtil.js';

const GUIDE_SNAP_PX = 6; // screen pixels; converted to world units by dividing by zoom

function clampNum(v: number, lo: number, hi: number): number {
  if (lo > hi) return (lo + hi) / 2;
  return Math.min(Math.max(v, lo), hi);
}

/** The slice of ArchimateDesigner this class needs to read/mutate. */
export interface CanvasInteractionsHost {
  model: ArchimateModel;
  renderer: Renderer;
  zoom: number;
  selected: Set<string>;
  statusEl: HTMLDivElement;
  activeRelType: RelationshipType | null;
  pendingSource: string | null;
  _setSelection(idSet: Set<string>): void;
  _afterModelChange(): void;
  _cancelActiveTool(): void;
  addRelationship(type: RelationshipType, sourceId: string, targetId: string, opts?: { name?: string }): ArchimateRelationship;
  _clientToWorld(cx: number, cy: number): { x: number; y: number };
}

export class CanvasInteractions {
  constructor(private host: CanvasInteractionsHost) {}

  // ================= element interactions =================
  onElementPointerDown(e: PointerEvent, id: string): void {
    e.stopPropagation();
    const host = this.host;
    if (host.activeRelType) {
      if (!host.pendingSource) {
        host.pendingSource = id;
        host._setSelection(new Set([id]));
        host.statusEl.textContent = `Source selected. Click a target element for ${humanize(host.activeRelType)}.`;
      } else {
        const type = host.activeRelType;
        const source = host.pendingSource;
        host._cancelActiveTool();
        if (source !== id) host.addRelationship(type, source, id);
        host._setSelection(new Set());
      }
      return;
    }
    if (e.shiftKey) {
      const next = new Set(host.selected);
      if (next.has(id)) next.delete(id); else next.add(id);
      host._setSelection(next);
      return;
    }
    if (!host.selected.has(id) || host.selected.size <= 1) host._setSelection(new Set([id]));

    // Move every selected element together, keyed off the one that was
    // actually grabbed (its box drives alignment-guide snapping). Nested
    // children move along with their container even when not individually
    // selected.
    const baseIds = [...host.selected].filter(sid => host.model.elements.has(sid));
    if (!baseIds.includes(id)) baseIds.push(id);
    const movingIds = this.expandWithDescendants(baseIds);
    const movingSet = new Set(movingIds);
    const starts = new Map(movingIds.map(mid => {
      const m = host.model.getElement(mid)!;
      return [mid, { x: m.x, y: m.y }] as const;
    }));
    const primary = host.model.getElement(id)!;
    const others = [...host.model.elements.values()].filter(o => !movingSet.has(o.id)).map(o => o.bounds());
    const startX = e.clientX, startY = e.clientY;
    let moved = false;
    let hoverContainerId: string | null = null;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / host.zoom;
      const dy = (ev.clientY - startY) / host.zoom;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) moved = true;
      const primaryStart = starts.get(id)!;
      const threshold = GUIDE_SNAP_PX / host.zoom;
      const snap = computeMoveSnap({ x: primaryStart.x + dx, y: primaryStart.y + dy, w: primary.w, h: primary.h }, others, threshold);
      const snapDx = dx + snap.dx, snapDy = dy + snap.dy;
      for (const mid of movingIds) {
        const s = starts.get(mid)!;
        const m = host.model.getElement(mid)!;
        m.x = s.x + snapDx;
        m.y = s.y + snapDy;
        host.renderer.moveElementDom(m);
        host.renderer.rerouteConnected(mid);
      }
      host.renderer.showGuides(snap.guides);

      // Highlight a candidate container under the grabbed element, mirroring
      // the blue "drop into me" highlight described for Archi's container
      // elements.
      const newHoverId = canNest(primary.type)
        ? this.hitTestContainerFor(id, primary.x + primary.w / 2, primary.y + primary.h / 2, movingSet)?.id ?? null
        : null;
      if (newHoverId !== hoverContainerId) {
        if (hoverContainerId) host.renderer.elementDom.get(hoverContainerId)?.classList.remove('am-nest-target');
        if (newHoverId) host.renderer.elementDom.get(newHoverId)?.classList.add('am-nest-target');
        hoverContainerId = newHoverId;
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      host.renderer.clearGuides();
      if (hoverContainerId) host.renderer.elementDom.get(hoverContainerId)?.classList.remove('am-nest-target');
      if (moved) {
        this.resolveNestingAfterMove(movingIds);
        host._afterModelChange();
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // Every element nested (directly or transitively) inside one of `ids`,
  // plus `ids` themselves — used so dragging a container carries its
  // children along even when they aren't individually selected.
  private expandWithDescendants(ids: string[]): string[] {
    const result = new Set(ids);
    let changed = true;
    while (changed) {
      changed = false;
      for (const elObj of this.host.model.elements.values()) {
        if (elObj.parentId && result.has(elObj.parentId) && !result.has(elObj.id)) {
          result.add(elObj.id);
          changed = true;
        }
      }
    }
    return [...result];
  }

  // Topmost element (excluding `excludeIds` and any of `elId`'s own
  // descendants, to avoid nesting cycles) whose bounds contain (x, y).
  hitTestContainerFor(elId: string, x: number, y: number, excludeIds: Set<string>): ArchimateElement | null {
    const model = this.host.model;
    let best: ArchimateElement | null = null;
    for (const cand of model.elements.values()) {
      if (cand.id === elId || excludeIds.has(cand.id)) continue;
      if (!canNest(cand.type)) continue;
      if (model.isDescendantOf(cand.id, elId)) continue;
      const b = cand.bounds();
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) best = cand;
    }
    return best;
  }

  // Recursively moves an element and everything nested inside it by the
  // same delta, keeping a container's whole subtree visually attached.
  private moveSubtree(id: string, dx: number, dy: number): void {
    if (!dx && !dy) return;
    const host = this.host;
    const elObj = host.model.getElement(id);
    if (!elObj) return;
    elObj.x += dx;
    elObj.y += dy;
    host.renderer.moveElementDom(elObj);
    host.renderer.rerouteConnected(id);
    for (const child of host.model.getChildren(id)) this.moveSubtree(child.id, dx, dy);
  }

  // Makes `child` a visual child of `parent`: fits it inside the parent's
  // box (growing the parent if it doesn't already fit) and records the
  // containment. Mirrors Archi's "Container Elements" nesting — this alone
  // does not create a semantic relationship, see offerNestingRelationships.
  nestChild(parent: ArchimateElement, child: ArchimateElement): void {
    const host = this.host;
    const PAD = 10, HEADER = 26;
    const siblings = host.model.getChildren(parent.id).filter(c => c.id !== child.id);
    const fits = child.x >= parent.x + PAD && child.x + child.w <= parent.x + parent.w - PAD &&
      child.y >= parent.y + HEADER && child.y + child.h <= parent.y + parent.h - PAD;
    const targetX = fits ? child.x : parent.x + PAD;
    const targetY = fits
      ? child.y
      : (siblings.length ? siblings.reduce((m, c) => Math.max(m, c.y + c.h), parent.y + HEADER) + PAD : parent.y + HEADER);
    const neededRight = targetX + child.w + PAD;
    const neededBottom = targetY + child.h + PAD;
    if (neededRight > parent.x + parent.w) parent.w = neededRight - parent.x;
    if (neededBottom > parent.y + parent.h) parent.h = neededBottom - parent.y;
    host.renderer.updateElementGeometry(parent);
    host.renderer.rerouteConnected(parent.id);
    child.parentId = parent.id;
    this.moveSubtree(child.id, targetX - child.x, targetY - child.y);
    host.renderer.reorderByContainment();
  }

  // After a drag ends, checks whether any of the top-level moved elements
  // (i.e. not ones just carried along as a descendant of another mover)
  // landed on/off a container, and applies the resulting nesting.
  private resolveNestingAfterMove(movingIds: string[]): void {
    const model = this.host.model;
    const movingSet = new Set(movingIds);
    const pendingPairs: { parent: ArchimateElement; child: ArchimateElement }[] = [];
    for (const id of movingIds) {
      const elObj = model.getElement(id);
      if (!elObj || !canNest(elObj.type)) continue;
      if (elObj.parentId && movingSet.has(elObj.parentId)) continue; // moving with its own container already
      const cx = elObj.x + elObj.w / 2, cy = elObj.y + elObj.h / 2;
      const target = this.hitTestContainerFor(id, cx, cy, movingSet);
      if (target && target.id !== elObj.parentId) {
        pendingPairs.push({ parent: target, child: elObj });
      } else if (!target && elObj.parentId) {
        const oldParent = model.getElement(elObj.parentId);
        const stillInside = !!oldParent && elObj.x >= oldParent.x && elObj.x + elObj.w <= oldParent.x + oldParent.w &&
          elObj.y >= oldParent.y && elObj.y + elObj.h <= oldParent.y + oldParent.h;
        if (!stillInside) elObj.parentId = null;
      }
    }
    for (const { parent, child } of pendingPairs) this.nestChild(parent, child);
    if (pendingPairs.length) this.offerNestingRelationships(pendingPairs);
  }

  // Offers to create the ArchiMate relationship(s) implied by one or more
  // fresh nestings. Pairs with only the generic Association fallback legal
  // are created silently; pairs with a real choice get a picker dialog
  // (mirrors Archi's "Dialog to create a new nested relationship").
  offerNestingRelationships(pairs: { parent: ArchimateElement; child: ArchimateElement }[]): void {
    const rows = pairs
      .map(p => ({ parent: p.parent, child: p.child, options: legalNestingRelationships(p.parent.type, p.child.type) }))
      .filter(r => r.options.length > 0);
    const dialogRows: typeof rows = [];
    for (const row of rows) {
      if (row.options.length <= 1) {
        const opt = row.options[0];
        if (opt) this.applyNestingRelation(row.parent, row.child, opt);
      } else {
        dialogRows.push(row);
      }
    }
    if (dialogRows.length) this.showNestingDialog(dialogRows);
  }

  private applyNestingRelation(parent: ArchimateElement, child: ArchimateElement, opt: NestingRelationOption): void {
    const source = opt.direction === 'forward' ? parent : child;
    const target = opt.direction === 'forward' ? child : parent;
    this.host.addRelationship(opt.type, source.id, target.id);
  }

  private showNestingDialog(rows: { parent: ArchimateElement; child: ArchimateElement; options: NestingRelationOption[] }[]): void {
    const overlay = el('div', 'am-modal-overlay');
    const modal = el('div', 'am-modal');
    const title = el('div', 'am-modal-title');
    title.textContent = rows.length === 1 ? 'Create a relationship?' : 'Create relationships?';
    const body = el('div', 'am-modal-body');
    const rowSelects: { select: HTMLSelectElement; parent: ArchimateElement; child: ArchimateElement }[] = [];
    for (const row of rows) {
      const rowEl = el('div', 'am-nest-row');
      const label = el('span', 'am-nest-row-label');
      label.textContent = `${row.child.name || humanize(row.child.type)} → ${row.parent.name || humanize(row.parent.type)}`;
      const select = el('select', 'am-nest-row-select');
      const noneOpt = document.createElement('option');
      noneOpt.value = '';
      noneOpt.textContent = '(none)';
      select.appendChild(noneOpt);
      const defaultOpt = row.options.find(o => o.type !== 'Association') || row.options[0];
      for (const opt of row.options) {
        const optionEl = document.createElement('option');
        optionEl.value = `${opt.type}|${opt.direction}`;
        optionEl.textContent = humanize(opt.type) + (opt.direction === 'reverse' ? ' (reverse)' : '');
        if (defaultOpt && opt.type === defaultOpt.type && opt.direction === defaultOpt.direction) optionEl.selected = true;
        select.appendChild(optionEl);
      }
      rowEl.append(label, select);
      body.appendChild(rowEl);
      rowSelects.push({ select, parent: row.parent, child: row.child });
    }
    const actions = el('div', 'am-modal-actions');
    const cancelBtn = el('button', 'am-btn');
    cancelBtn.textContent = 'Cancel';
    const createBtn = el('button', 'am-btn am-btn-primary');
    createBtn.textContent = rows.length === 1 ? 'Create' : 'Create Selected';
    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKeydown); };
    const confirm = () => {
      for (const { select, parent, child } of rowSelects) {
        if (!select.value) continue;
        const [type, direction] = select.value.split('|') as [RelationshipType, 'forward' | 'reverse'];
        this.applyNestingRelation(parent, child, { type, direction });
      }
      close();
    };
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'Enter') { e.preventDefault(); confirm(); }
    };
    cancelBtn.addEventListener('click', close);
    createBtn.addEventListener('click', confirm);
    actions.append(cancelBtn, createBtn);
    modal.append(title, body, actions);
    overlay.appendChild(modal);
    overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onKeydown);
    document.body.appendChild(overlay);
    rowSelects[0]?.select.focus();
  }

  onEdgeClick(e: PointerEvent, id: string): void {
    const host = this.host;
    if (host.activeRelType) return;
    if (e.shiftKey) {
      const next = new Set(host.selected);
      if (next.has(id)) next.delete(id); else next.add(id);
      host._setSelection(next);
      return;
    }
    host._setSelection(new Set([id]));
  }

  // Returns the element under (x,y) in world space, excluding excludeId, or
  // null if none — used to detect "drop this hinge onto a different
  // element" while dragging. Picks the last (topmost-drawn) match.
  private hitTestElement(x: number, y: number, excludeId: string): ArchimateElement | null {
    let best: ArchimateElement | null = null;
    for (const elObj of this.host.model.elements.values()) {
      if (elObj.id === excludeId) continue;
      const b = elObj.bounds();
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) best = elObj;
    }
    return best;
  }

  // Drag a connector's source/target hinge point. While dragging, it slides
  // along whichever element's boundary is currently under the pointer,
  // snapped to the grid — normally that's the element it's already
  // attached to (unchanged, matching the previous behavior), but dropping
  // it directly onto a *different* element re-targets the connector to
  // attach there instead (source/target reassigned). Dragging over empty
  // space keeps it constrained to the originally-attached element.
  onHingePointerDown(e: PointerEvent, relId: string, end: 'source' | 'target'): void {
    e.preventDefault();
    const host = this.host;
    const rel = host.model.relationships.get(relId);
    if (!rel) return;
    const originalElId = end === 'source' ? rel.source : rel.target;
    const otherEndElId = end === 'source' ? rel.target : rel.source;
    const originalEl = host.model.getElement(originalElId);
    if (!originalEl) return;
    // Dragging the endpoint itself always means repositioning it — any
    // previously-set manual bend shape was tailored to the old position and
    // is now stale, even if it ends up back on the same element.
    rel.bendpoints = null;
    host._setSelection(new Set([relId]));
    let hoverTargetId: string | null = null;
    const move = (ev: PointerEvent) => {
      const world = host._clientToWorld(ev.clientX, ev.clientY);
      const hit = this.hitTestElement(world.x, world.y, otherEndElId);
      const attachEl = hit || originalEl;
      const snapped = snappedPerimeterPoint(attachEl.bounds(), world.x, world.y, GRID_SIZE);
      const port = { side: snapped.side, t: snapped.t };
      if (end === 'source') { rel.source = attachEl.id; rel.sourcePort = port; }
      else { rel.target = attachEl.id; rel.targetPort = port; }

      const newHoverId = hit && hit.id !== originalElId ? hit.id : null;
      if (newHoverId !== hoverTargetId) {
        if (hoverTargetId) host.renderer.elementDom.get(hoverTargetId)?.classList.remove('am-hinge-target');
        if (newHoverId) host.renderer.elementDom.get(newHoverId)?.classList.add('am-hinge-target');
        hoverTargetId = newHoverId;
      }
      host.renderer.renderEdge(rel);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (hoverTargetId) host.renderer.elementDom.get(hoverTargetId)?.classList.remove('am-hinge-target');
      host._afterModelChange();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // Resize an element by dragging one of its 8 handles: snaps the moving
  // edge to other elements' edges/centers first (PowerPoint-style smart
  // guides), falling back to the grid when nothing else lines up.
  onResizeHandlePointerDown(e: PointerEvent, elId: string, handle: ResizeHandle): void {
    e.preventDefault();
    const host = this.host;
    const elModel = host.model.getElement(elId);
    if (!elModel) return;
    host._setSelection(new Set([elId]));
    const start = { x: elModel.x, y: elModel.y, w: elModel.w, h: elModel.h };
    const startWorld = host._clientToWorld(e.clientX, e.clientY);
    const others = [...host.model.elements.values()].filter(o => o.id !== elId).map(o => o.bounds());
    const move = (ev: PointerEvent) => {
      const world = host._clientToWorld(ev.clientX, ev.clientY);
      const dx = world.x - startWorld.x, dy = world.y - startWorld.y;
      let box = computeResizedBox(start, handle, dx, dy);
      box = enforceMinSize(start, handle, box);
      const threshold = GUIDE_SNAP_PX / host.zoom;
      const snap = computeResizeSnap(handle, box, others, threshold, GRID_SIZE);
      elModel.x = snap.x; elModel.y = snap.y; elModel.w = snap.w; elModel.h = snap.h;
      host.renderer.updateElementGeometry(elModel);
      host.renderer.rerouteConnected(elId);
      host.renderer.showGuides(snap.guides);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      host.renderer.clearGuides();
      host._afterModelChange();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // Drag one straight segment of a connector's route perpendicular to
  // itself: both its endpoints shift together, so the segments on either
  // side stretch to stay connected. If an endpoint is the source/target
  // hinge itself, it slides along that element's boundary right along with
  // the segment (clamped to the boundary, and rel.sourcePort/targetPort
  // updated) instead of being left behind; otherwise it's a plain bend
  // point and just moves freely. Converts the edge to a manually-bent route
  // (relationship.bendpoints), same as hinge dragging.
  onSegmentPointerDown(e: PointerEvent, relId: string, segIndex: number): void {
    e.preventDefault();
    const host = this.host;
    const rel = host.model.relationships.get(relId);
    if (!rel) return;
    const basePts = host.renderer.lastPoints.get(relId);
    if (!basePts || segIndex < 0 || segIndex + 1 > basePts.length - 1) return;
    host._setSelection(new Set([relId]));
    const a0 = basePts[segIndex], b0 = basePts[segIndex + 1];
    const horizontal = a0.y === b0.y;
    const isSourceEnd = segIndex === 0;
    const isTargetEnd = segIndex + 1 === basePts.length - 1;
    const sourceBox = isSourceEnd ? host.model.getElement(rel.source)?.bounds() : undefined;
    const targetBox = isTargetEnd ? host.model.getElement(rel.target)?.bounds() : undefined;
    const startWorld = host._clientToWorld(e.clientX, e.clientY);
    const move = (ev: PointerEvent) => {
      const world = host._clientToWorld(ev.clientX, ev.clientY);
      const pts = basePts.map(p => ({ ...p }));
      if (horizontal) {
        let ny = Math.round((a0.y + (world.y - startWorld.y)) / GRID_SIZE) * GRID_SIZE;
        if (sourceBox) ny = clampNum(ny, sourceBox.y, sourceBox.y + sourceBox.h);
        if (targetBox) ny = clampNum(ny, targetBox.y, targetBox.y + targetBox.h);
        pts[segIndex] = { x: a0.x, y: ny };
        pts[segIndex + 1] = { x: b0.x, y: ny };
      } else {
        let nx = Math.round((a0.x + (world.x - startWorld.x)) / GRID_SIZE) * GRID_SIZE;
        if (sourceBox) nx = clampNum(nx, sourceBox.x, sourceBox.x + sourceBox.w);
        if (targetBox) nx = clampNum(nx, targetBox.x, targetBox.x + targetBox.w);
        pts[segIndex] = { x: nx, y: a0.y };
        pts[segIndex + 1] = { x: nx, y: b0.y };
      }
      if (sourceBox) { const np = nearestPerimeterPoint(sourceBox, pts[0].x, pts[0].y); rel.sourcePort = { side: np.side, t: np.t }; }
      if (targetBox) { const np = nearestPerimeterPoint(targetBox, pts[pts.length - 1].x, pts[pts.length - 1].y); rel.targetPort = { side: np.side, t: np.t }; }
      rel.bendpoints = simplifyCollinear(pts);
      host.renderer.renderEdge(rel);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      host._afterModelChange();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
}
