// Orthogonal (Manhattan-style) connector routing with obstacle avoidance.
//
// Approach: build a sparse "visibility grid" from the interesting x/y
// coordinates of every obstacle (element bounding boxes, expanded by a
// margin) plus the port coordinates of the edge being routed. Edges of the
// grid that cross an obstacle are pruned, then A* finds the shortest path
// that also minimizes bends. Repeated routing calls share a "lane usage"
// map so that parallel connectors spread into adjacent lanes instead of
// drawing exactly on top of one another.

import type { Bounds, Point, Port } from './model.js';

const MARGIN = 16; // clearance kept around every obstacle
const BEND_PENALTY = 40; // discourages unnecessary turns
const OVERLAP_PENALTY = 22; // discourages routing on top of another edge's segment
const PORT_STUB = 14; // minimum straight stub leaving an element before it may turn

type Dir = 'n' | 's' | 'e' | 'w';
interface PortPoint extends Point { dir: Dir; }
interface ExpandedBox { x1: number; y1: number; x2: number; y2: number; }
export interface RouteOpts { sourcePort?: Port | null; targetPort?: Port | null; }

function segKey(x1: number, y1: number, x2: number, y2: number): string {
  // order-independent key for a segment so overlap in either direction counts
  const a = `${Math.round(x1)},${Math.round(y1)}`;
  const b = `${Math.round(x2)},${Math.round(y2)}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function expand(box: Bounds, m: number): ExpandedBox {
  return { x1: box.x - m, y1: box.y - m, x2: box.x + box.w + m, y2: box.y + box.h + m };
}

function segmentIntersectsBox(x1: number, y1: number, x2: number, y2: number, box: ExpandedBox): boolean {
  // segments here are always axis-aligned (horizontal or vertical)
  const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
  const overlapX = maxX > box.x1 + 0.01 && minX < box.x2 - 0.01;
  const overlapY = maxY > box.y1 + 0.01 && minY < box.y2 - 0.01;
  return overlapX && overlapY;
}

// pick the exit side/point on an element's boundary that faces roughly
// toward `toward` (another point).
function pickPort(box: Bounds, toward: Point): PortPoint {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const dx = toward.x - cx, dy = toward.y - cy;
  const ax = Math.abs(dx) / Math.max(box.w / 2, 1);
  const ay = Math.abs(dy) / Math.max(box.h / 2, 1);
  if (ax > ay) {
    if (dx >= 0) return { x: box.x + box.w, y: clamp(toward.y, box.y + 8, box.y + box.h - 8), dir: 'e' };
    return { x: box.x, y: clamp(toward.y, box.y + 8, box.y + box.h - 8), dir: 'w' };
  } else {
    if (dy >= 0) return { x: clamp(toward.x, box.x + 8, box.x + box.w - 8), y: box.y + box.h, dir: 's' };
    return { x: clamp(toward.x, box.x + 8, box.x + box.w - 8), y: box.y, dir: 'n' };
  }
}
function clamp(v: number, lo: number, hi: number): number {
  if (lo > hi) return (lo + hi) / 2;
  return Math.min(Math.max(v, lo), hi);
}

function stubPoint(port: PortPoint): Point {
  switch (port.dir) {
    case 'e': return { x: port.x + PORT_STUB, y: port.y };
    case 'w': return { x: port.x - PORT_STUB, y: port.y };
    case 's': return { x: port.x, y: port.y + PORT_STUB };
    case 'n': return { x: port.x, y: port.y - PORT_STUB };
  }
}

// Resolve a stored { side, t } hinge point to absolute coordinates on box.
export function fixedPort(box: Bounds, port: Port): PortPoint {
  switch (port.side) {
    case 'n': return { x: box.x + port.t * box.w, y: box.y, dir: 'n' };
    case 's': return { x: box.x + port.t * box.w, y: box.y + box.h, dir: 's' };
    case 'w': return { x: box.x, y: box.y + port.t * box.h, dir: 'w' };
    case 'e': return { x: box.x + box.w, y: box.y + port.t * box.h, dir: 'e' };
    default: return { x: box.x, y: box.y, dir: 'n' };
  }
}

// Nearest point on box's perimeter to (x,y).
export function nearestPerimeterPoint(box: Bounds, x: number, y: number): Port & Point {
  const cx = clamp(x, box.x, box.x + box.w);
  const cy = clamp(y, box.y, box.y + box.h);
  const candidates = (
    [
      { side: 'n', x: cx, y: box.y },
      { side: 's', x: cx, y: box.y + box.h },
      { side: 'w', x: box.x, y: cy },
      { side: 'e', x: box.x + box.w, y: cy },
    ] as { side: Port['side']; x: number; y: number }[]
  ).map(c => ({ ...c, d: Math.hypot(x - c.x, y - c.y) }));
  candidates.sort((a, b) => a.d - b.d);
  const best = candidates[0];
  const t = best.side === 'n' || best.side === 's'
    ? (box.w ? (best.x - box.x) / box.w : 0.5)
    : (box.h ? (best.y - box.y) / box.h : 0.5);
  return { x: best.x, y: best.y, side: best.side, t: clamp(t, 0, 1) };
}

// Nearest point on box's perimeter to (x,y), with the coordinate that runs
// along the chosen edge snapped to the given grid size.
export function snappedPerimeterPoint(box: Bounds, x: number, y: number, gridSize: number): Port & Point {
  const near = nearestPerimeterPoint(box, x, y);
  if (near.side === 'n' || near.side === 's') {
    const sx = clamp(Math.round(x / gridSize) * gridSize, box.x, box.x + box.w);
    return { x: sx, y: near.y, side: near.side, t: box.w ? (sx - box.x) / box.w : 0.5 };
  }
  const sy = clamp(Math.round(y / gridSize) * gridSize, box.y, box.y + box.h);
  return { x: near.x, y: sy, side: near.side, t: box.h ? (sy - box.y) / box.h : 0.5 };
}

interface AStarNode { i: number; j: number; f: number; }

export class OrthogonalRouter {
  private laneUsage = new Map<string, number>(); // segKey -> count, reset per full layout pass
  private edgeSegments = new Map<string, string[]>(); // edgeId -> segKey[] currently attributed to it

  resetLanes(): void { this.laneUsage.clear(); this.edgeSegments.clear(); }

  /** Drop an edge's lane-usage bookkeeping, e.g. when it's deleted. */
  releaseEdge(edgeId: string): void {
    const segs = this.edgeSegments.get(edgeId);
    if (!segs) return;
    for (const sk of segs) {
      const n = (this.laneUsage.get(sk) || 1) - 1;
      if (n <= 0) this.laneUsage.delete(sk); else this.laneUsage.set(sk, n);
    }
    this.edgeSegments.delete(edgeId);
  }

  /**
   * Route a single identified edge, releasing its previous lane usage first
   * so incremental re-routes (e.g. during drag) don't accumulate stale bias.
   */
  routeEdge(edgeId: string, sourceBox: Bounds, targetBox: Bounds, obstacles: Bounds[], opts?: RouteOpts): Point[] {
    this.releaseEdge(edgeId);
    const pts = this.route(sourceBox, targetBox, obstacles, opts);
    const segs: string[] = [];
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k], b = pts[k + 1];
      segs.push(segKey(a.x, a.y, b.x, b.y));
    }
    this.edgeSegments.set(edgeId, segs);
    return pts;
  }

  /**
   * Route one edge.
   * @param obstacles - other element boxes to avoid
   * @param opts - manually pinned hinge points (from a user drag); omitted sides are auto-picked
   * @returns polyline points including start & end
   */
  route(sourceBox: Bounds, targetBox: Bounds, obstacles: Bounds[], opts?: RouteOpts): Point[] {
    const sCenter = { x: sourceBox.x + sourceBox.w / 2, y: sourceBox.y + sourceBox.h / 2 };
    const tCenter = { x: targetBox.x + targetBox.w / 2, y: targetBox.y + targetBox.h / 2 };
    const sPort = opts?.sourcePort ? fixedPort(sourceBox, opts.sourcePort) : pickPort(sourceBox, tCenter);
    const tPort = opts?.targetPort ? fixedPort(targetBox, opts.targetPort) : pickPort(targetBox, sCenter);
    const sStub = stubPoint(sPort);
    const tStub = stubPoint(tPort);

    const obBoxes = obstacles.map(b => expand(b, MARGIN));

    // build candidate coordinate lines
    const xs = new Set([sStub.x, tStub.x, sPort.x, tPort.x]);
    const ys = new Set([sStub.y, tStub.y, sPort.y, tPort.y]);
    for (const b of obBoxes) { xs.add(b.x1); xs.add(b.x2); ys.add(b.y1); ys.add(b.y2); }
    const gx = [...xs].sort((a, b) => a - b);
    const gy = [...ys].sort((a, b) => a - b);

    const blocks = (x1: number, y1: number, x2: number, y2: number) => obBoxes.some(b => segmentIntersectsBox(x1, y1, x2, y2, b));

    // A* over the implicit grid graph (nodes = gx[i], gy[j])
    const nodeId = (i: number, j: number) => i * gy.length + j;
    const start = { i: nearestIdx(gx, sStub.x), j: nearestIdx(gy, sStub.y) };
    const goal = { i: nearestIdx(gx, tStub.x), j: nearestIdx(gy, tStub.y) };

    const openSet = new Map<number, AStarNode>();
    const startId = nodeId(start.i, start.j);
    const gScore = new Map<number, number>([[startId, 0]]);
    const cameFrom = new Map<number, number>();
    const dirOf = new Map<number, 'h' | 'v'>(); // node -> incoming direction
    const heuristic = (i: number, j: number) => Math.abs(gx[i] - gx[goal.i]) + Math.abs(gy[j] - gy[goal.j]);
    openSet.set(startId, { i: start.i, j: start.j, f: heuristic(start.i, start.j) });

    const goalId = nodeId(goal.i, goal.j);
    let found = false;
    let guard = 0;
    while (openSet.size && guard++ < 20000) {
      let curId = -1, cur: AStarNode | null = null, bestF = Infinity;
      for (const [id, node] of openSet) { if (node.f < bestF) { bestF = node.f; curId = id; cur = node; } }
      openSet.delete(curId);
      if (!cur) break;
      if (curId === goalId) { found = true; break; }
      const neighbors: { i: number; j: number; d: 'h' | 'v' }[] = [
        { i: cur.i - 1, j: cur.j, d: 'h' }, { i: cur.i + 1, j: cur.j, d: 'h' },
        { i: cur.i, j: cur.j - 1, d: 'v' }, { i: cur.i, j: cur.j + 1, d: 'v' },
      ];
      for (const n of neighbors) {
        if (n.i < 0 || n.i >= gx.length || n.j < 0 || n.j >= gy.length) continue;
        const x1 = gx[cur.i], y1 = gy[cur.j], x2 = gx[n.i], y2 = gy[n.j];
        if (blocks(x1, y1, x2, y2)) continue;
        const dist = Math.abs(x2 - x1) + Math.abs(y2 - y1);
        const prevDir = dirOf.get(curId);
        const bend = prevDir && prevDir !== n.d ? BEND_PENALTY : 0;
        const overlap = (this.laneUsage.get(segKey(x1, y1, x2, y2)) || 0) * OVERLAP_PENALTY;
        const tentative = (gScore.get(curId) ?? Infinity) + dist + bend + overlap;
        const nId = nodeId(n.i, n.j);
        if (tentative < (gScore.get(nId) ?? Infinity)) {
          gScore.set(nId, tentative);
          cameFrom.set(nId, curId);
          dirOf.set(nId, n.d);
          const f = tentative + heuristic(n.i, n.j);
          openSet.set(nId, { i: n.i, j: n.j, f });
        }
      }
    }

    let gridPath: Point[] = [];
    if (found) {
      let curId: number | undefined = goalId;
      const pts: Point[] = [];
      while (curId !== undefined) {
        const i = Math.floor(curId / gy.length), j = curId % gy.length;
        pts.push({ x: gx[i], y: gy[j] });
        curId = cameFrom.get(curId);
      }
      gridPath = pts.reverse();
    } else {
      // fallback: direct stub-to-stub elbow, no obstacle awareness
      gridPath = [sStub, { x: sStub.x, y: tStub.y }, tStub];
    }

    let full: Point[] = [sPort, sStub, ...gridPath, tStub, tPort];
    full = simplifyCollinear(full);
    full = dedupe(full);

    // record lane usage so subsequent edges prefer alternate corridors
    for (let k = 0; k < full.length - 1; k++) {
      const a = full[k], b = full[k + 1];
      const sk = segKey(a.x, a.y, b.x, b.y);
      this.laneUsage.set(sk, (this.laneUsage.get(sk) || 0) + 1);
    }
    return full;
  }
}

function nearestIdx(arr: number[], v: number): number {
  let best = 0, bd = Infinity;
  for (let i = 0; i < arr.length; i++) { const d = Math.abs(arr[i] - v); if (d < bd) { bd = d; best = i; } }
  return best;
}

export function simplifyCollinear(pts: Point[]): Point[] {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1], b = pts[i], c = pts[i + 1];
    const collinear = (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y);
    if (!collinear) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}
function dedupe(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) > 0.5 || Math.abs(last.y - p.y) > 0.5) out.push(p);
  }
  return out;
}

export function pathLength(pts: Point[]): number {
  let len = 0;
  for (let i = 0; i < pts.length - 1; i++) len += Math.abs(pts[i + 1].x - pts[i].x) + Math.abs(pts[i + 1].y - pts[i].y);
  return len;
}

export interface LabelPosition extends Point { horizontal: boolean; }

// Best point + direction to place a label: midpoint of the longest segment.
export function labelPosition(pts: Point[]): LabelPosition {
  let bestLen = -1, bestIdx = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const l = Math.abs(pts[i + 1].x - pts[i].x) + Math.abs(pts[i + 1].y - pts[i].y);
    if (l > bestLen) { bestLen = l; bestIdx = i; }
  }
  const a = pts[bestIdx], b = pts[bestIdx + 1];
  const horizontal = a.y === b.y;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, horizontal };
}
