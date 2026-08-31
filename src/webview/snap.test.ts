import { describe, it, expect } from 'vitest';
import { computeMoveSnap, computeResizedBox, enforceMinSize, computeResizeSnap, MIN_W, MIN_H } from './snap.js';
import type { Bounds } from './model.js';

describe('computeMoveSnap', () => {
  it('snaps to a nearby element edge within the threshold', () => {
    const box: Bounds = { x: 100, y: 100, w: 140, h: 55 };
    // another element whose left edge (x=243) is 3px right of box's right edge (x=240)
    const other: Bounds = { x: 243, y: 300, w: 140, h: 55 };
    const result = computeMoveSnap(box, [other], 6);
    // box's right edge (240) should snap to other's left edge (243): dx = 243-240 = 3
    expect(result.dx).toBe(3);
    expect(result.guides.length).toBeGreaterThan(0);
  });

  it('is a no-op when nothing is within the threshold', () => {
    const box: Bounds = { x: 0, y: 0, w: 140, h: 55 };
    const other: Bounds = { x: 1000, y: 1000, w: 140, h: 55 };
    const result = computeMoveSnap(box, [other], 6);
    expect(result.dx).toBe(0);
    expect(result.dy).toBe(0);
    expect(result.guides).toEqual([]);
  });
});

describe('enforceMinSize', () => {
  it('clamps width to MIN_W, anchoring the opposite edge when dragging the w handle', () => {
    const start: Bounds = { x: 100, y: 100, w: 140, h: 55 };
    const shrunk: Bounds = { x: 220, y: 100, w: 20, h: 55 }; // dragged 'w' handle in past the right edge
    const result = enforceMinSize(start, 'w', shrunk);
    expect(result.w).toBe(MIN_W);
    // right edge (x + w) should stay anchored at start's right edge (100+140=240)
    expect(result.x + result.w).toBe(start.x + start.w);
  });

  it('clamps height to MIN_H, anchoring the opposite edge when dragging the n handle', () => {
    const start: Bounds = { x: 100, y: 100, w: 140, h: 55 };
    const shrunk: Bounds = { x: 100, y: 145, w: 140, h: 10 };
    const result = enforceMinSize(start, 'n', shrunk);
    expect(result.h).toBe(MIN_H);
    expect(result.y + result.h).toBe(start.y + start.h);
  });

  it('leaves a box alone when already above minimum size', () => {
    const start: Bounds = { x: 0, y: 0, w: 140, h: 55 };
    const box: Bounds = { x: 0, y: 0, w: 140, h: 55 };
    expect(enforceMinSize(start, 'se', box)).toEqual(box);
  });
});

describe('computeResizedBox', () => {
  it('applies an "e" (east) handle drag by growing width only', () => {
    const start: Bounds = { x: 100, y: 100, w: 140, h: 55 };
    const result = computeResizedBox(start, 'e', 20, 0);
    expect(result).toEqual({ x: 100, y: 100, w: 160, h: 55 });
  });

  it('applies an "nw" (north-west) handle drag by moving x/y and shrinking w/h', () => {
    const start: Bounds = { x: 100, y: 100, w: 140, h: 55 };
    const result = computeResizedBox(start, 'nw', 10, 5);
    expect(result).toEqual({ x: 110, y: 105, w: 130, h: 50 });
  });
});

describe('computeResizeSnap', () => {
  it('snaps a dragged edge to another element edge/center when within threshold', () => {
    const box: Bounds = { x: 100, y: 100, w: 143, h: 55 }; // right edge at 243
    const other: Bounds = { x: 240, y: 300, w: 140, h: 55 }; // left edge at 240
    const result = computeResizeSnap('e', box, [other], 6, 10);
    expect(result.w).toBe(140); // 240 - 100
    expect(result.guides.length).toBe(1);
  });

  it('falls back to the grid when no element is within threshold', () => {
    const box: Bounds = { x: 100, y: 100, w: 143, h: 55 }; // right edge at 243
    const result = computeResizeSnap('e', box, [], 6, 10);
    expect(result.w).toBe(140); // 243 rounds to nearest grid-of-10 -> 240; w = 240-100
    expect(result.guides).toEqual([]);
  });
});
