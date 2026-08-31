import { describe, it, expect } from 'vitest';
import { nearestPerimeterPoint, snappedPerimeterPoint, simplifyCollinear, pathLength, OrthogonalRouter } from './router.js';
import type { Bounds, Point } from './model.js';

describe('nearestPerimeterPoint', () => {
  it('picks the closest edge and reports the fractional position along it', () => {
    const box: Bounds = { x: 0, y: 0, w: 100, h: 50 };
    const result = nearestPerimeterPoint(box, 50, -20); // straight above the box, centered
    expect(result).toEqual({ x: 50, y: 0, side: 'n', t: 0.5 });
  });
});

describe('snappedPerimeterPoint', () => {
  it('snaps the along-edge coordinate to the grid', () => {
    const box: Bounds = { x: 0, y: 0, w: 100, h: 50 };
    const result = snappedPerimeterPoint(box, 53, -20, 10);
    expect(result).toEqual({ x: 50, y: 0, side: 'n', t: 0.5 });
  });
});

describe('simplifyCollinear', () => {
  it('collapses collinear points but keeps corners', () => {
    const pts: Point[] = [{ x: 0, y: 0 }, { x: 0, y: 50 }, { x: 0, y: 100 }, { x: 50, y: 100 }];
    expect(simplifyCollinear(pts)).toEqual([{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 50, y: 100 }]);
  });

  it('leaves fewer than 3 points untouched', () => {
    const pts: Point[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
    expect(simplifyCollinear(pts)).toEqual(pts);
  });
});

describe('pathLength', () => {
  it('sums Manhattan segment lengths', () => {
    const pts: Point[] = [{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 50, y: 100 }];
    expect(pathLength(pts)).toBe(150);
  });
});

function segmentCrossesRect(p1: Point, p2: Point, box: Bounds): boolean {
  const minX = Math.min(p1.x, p2.x), maxX = Math.max(p1.x, p2.x);
  const minY = Math.min(p1.y, p2.y), maxY = Math.max(p1.y, p2.y);
  const overlapX = maxX > box.x && minX < box.x + box.w;
  const overlapY = maxY > box.y && minY < box.y + box.h;
  return overlapX && overlapY;
}

describe('OrthogonalRouter', () => {
  it('routes around an obstacle that blocks the direct path', () => {
    const router = new OrthogonalRouter();
    const source: Bounds = { x: 0, y: 0, w: 40, h: 40 };
    const target: Bounds = { x: 200, y: 0, w: 40, h: 40 };
    // a tall wall directly between source and target, spanning well past both boxes' y-range
    const obstacle: Bounds = { x: 80, y: -50, w: 40, h: 200 };

    const pts = router.route(source, target, [obstacle]);

    expect(pts[0]).toMatchObject({ x: 40, y: 20 }); // exits source's east side, toward target
    expect(pts[pts.length - 1]).toMatchObject({ x: 200, y: 20 }); // enters target's west side
    for (let i = 0; i < pts.length - 1; i++) {
      expect(segmentCrossesRect(pts[i], pts[i + 1], obstacle)).toBe(false);
    }
  });

  it('routes a direct elbow when nothing is in the way', () => {
    const router = new OrthogonalRouter();
    const source: Bounds = { x: 0, y: 0, w: 40, h: 40 };
    const target: Bounds = { x: 200, y: 0, w: 40, h: 40 };
    const pts = router.route(source, target, []);
    // same y-center on both ends with no obstacles -> a straight horizontal run
    expect(pts.every(p => p.y === 20)).toBe(true);
  });

  it('releaseEdge lets a re-routed edge stop biasing lane selection', () => {
    const router = new OrthogonalRouter();
    const source: Bounds = { x: 0, y: 0, w: 40, h: 40 };
    const target: Bounds = { x: 200, y: 0, w: 40, h: 40 };
    router.routeEdge('e1', source, target, []);
    expect(() => router.releaseEdge('e1')).not.toThrow();
    // releasing twice (e.g. a delete after an already-cleared edge) must not throw
    expect(() => router.releaseEdge('e1')).not.toThrow();
  });
});
