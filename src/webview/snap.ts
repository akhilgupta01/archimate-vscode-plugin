// Element move/resize snapping: grid snap for resize, plus PowerPoint-style
// "smart guide" alignment against the edges/centers of other elements.

import type { Bounds } from './model.js';

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const MIN_W = 50;
export const MIN_H = 30;
export const GRID_SIZE = 10;

export interface Guide { type: 'v' | 'h'; pos: number; from: number; to: number; }
export interface MoveSnapResult { dx: number; dy: number; guides: Guide[]; }
export interface ResizeSnapResult extends Bounds { guides: Guide[]; }

function snapToGrid(v: number, gridSize: number): number { return Math.round(v / gridSize) * gridSize; }

// Candidate alignment lines for a box: left/center/right (x) and top/middle/bottom (y).
function axisLines(box: Bounds) {
  return {
    xs: [box.x, box.x + box.w / 2, box.x + box.w],
    ys: [box.y, box.y + box.h / 2, box.y + box.h],
  };
}

/**
 * Snap a whole-element move. Checks the moving box's left/center/right and
 * top/middle/bottom against every other element's matching lines and, for
 * whichever axis has the closest match within `threshold`, nudges the box
 * into exact alignment.
 */
export function computeMoveSnap(box: Bounds, others: Bounds[], threshold: number): MoveSnapResult {
  const cand = axisLines(box);
  let bestX: { cand: number; target: number; other: Bounds } | null = null, bestXDelta = threshold;
  let bestY: { cand: number; target: number; other: Bounds } | null = null, bestYDelta = threshold;
  for (const o of others) {
    const t = axisLines(o);
    for (const cx of cand.xs) for (const tx of t.xs) {
      const d = Math.abs(cx - tx);
      if (d < bestXDelta) { bestXDelta = d; bestX = { cand: cx, target: tx, other: o }; }
    }
    for (const cy of cand.ys) for (const ty of t.ys) {
      const d = Math.abs(cy - ty);
      if (d < bestYDelta) { bestYDelta = d; bestY = { cand: cy, target: ty, other: o }; }
    }
  }
  const dx = bestX ? bestX.target - bestX.cand : 0;
  const dy = bestY ? bestY.target - bestY.cand : 0;
  const guides: Guide[] = [];
  const movedBox = { x: box.x + dx, y: box.y + dy, w: box.w, h: box.h };
  if (bestX) {
    const y0 = Math.min(movedBox.y, bestX.other.y) - 20;
    const y1 = Math.max(movedBox.y + movedBox.h, bestX.other.y + bestX.other.h) + 20;
    guides.push({ type: 'v', pos: bestX.target, from: y0, to: y1 });
  }
  if (bestY) {
    const x0 = Math.min(movedBox.x, bestY.other.x) - 20;
    const x1 = Math.max(movedBox.x + movedBox.w, bestY.other.x + bestY.other.w) + 20;
    guides.push({ type: 'h', pos: bestY.target, from: x0, to: x1 });
  }
  return { dx, dy, guides };
}

// Apply a resize handle drag (in world-space delta) to a box, before any snapping.
export function computeResizedBox(start: Bounds, handle: ResizeHandle, dx: number, dy: number): Bounds {
  let { x, y, w, h } = start;
  if (handle.includes('n')) { y = start.y + dy; h = start.h - dy; }
  if (handle.includes('s')) { h = start.h + dy; }
  if (handle.includes('w')) { x = start.x + dx; w = start.w - dx; }
  if (handle.includes('e')) { w = start.w + dx; }
  return { x, y, w, h };
}

export function enforceMinSize(start: Bounds, handle: ResizeHandle, box: Bounds): Bounds {
  let { x, y, w, h } = box;
  if (w < MIN_W) { if (handle.includes('w')) x = start.x + start.w - MIN_W; w = MIN_W; }
  if (h < MIN_H) { if (handle.includes('n')) y = start.y + start.h - MIN_H; h = MIN_H; }
  return { x, y, w, h };
}

/**
 * Snap a resize in progress: for each edge actually being dragged, prefer
 * aligning it with another element's edge/center line; otherwise fall back
 * to the canvas grid.
 */
export function computeResizeSnap(handle: ResizeHandle, box: Bounds, others: Bounds[], threshold: number, gridSize: number): ResizeSnapResult {
  let { x, y, w, h } = box;
  const guides: Guide[] = [];

  const snapEdge = (value: number, isX: boolean): { target: number; other: Bounds | null } => {
    let best: { target: number; other: Bounds } | null = null, bestDelta = threshold;
    for (const o of others) {
      const lines = isX ? axisLines(o).xs : axisLines(o).ys;
      for (const t of lines) {
        const d = Math.abs(value - t);
        if (d < bestDelta) { bestDelta = d; best = { target: t, other: o }; }
      }
    }
    if (best) return best;
    return { target: snapToGrid(value, gridSize), other: null };
  };

  if (handle.includes('n')) {
    const snap = snapEdge(y, false);
    h = (y + h) - snap.target;
    y = snap.target;
    if (snap.other) guides.push(guideFor('h', snap.target, { x, y, w, h }, snap.other));
  }
  if (handle.includes('s')) {
    const snap = snapEdge(y + h, false);
    h = snap.target - y;
    if (snap.other) guides.push(guideFor('h', snap.target, { x, y, w, h }, snap.other));
  }
  if (handle.includes('w')) {
    const snap = snapEdge(x, true);
    w = (x + w) - snap.target;
    x = snap.target;
    if (snap.other) guides.push(guideFor('v', snap.target, { x, y, w, h }, snap.other));
  }
  if (handle.includes('e')) {
    const snap = snapEdge(x + w, true);
    w = snap.target - x;
    if (snap.other) guides.push(guideFor('v', snap.target, { x, y, w, h }, snap.other));
  }
  return { x, y, w, h, guides };
}

function guideFor(type: 'v' | 'h', pos: number, box: Bounds, other: Bounds): Guide {
  if (type === 'v') {
    const y0 = Math.min(box.y, other.y) - 20;
    const y1 = Math.max(box.y + box.h, other.y + other.h) + 20;
    return { type: 'v', pos, from: y0, to: y1 };
  }
  const x0 = Math.min(box.x, other.x) - 20;
  const x1 = Math.max(box.x + box.w, other.x + other.w) + 20;
  return { type: 'h', pos, from: x0, to: x1 };
}
