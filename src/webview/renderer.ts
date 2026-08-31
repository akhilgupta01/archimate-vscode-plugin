import {
  LAYERS,
  ELEMENT_TYPES,
  RELATIONSHIP_TYPES,
  ArchimateModel,
  ArchimateElement,
  ArchimateRelationship,
  ElementTypeDef,
  Point,
} from "./model.js";
import { OrthogonalRouter, labelPosition } from "./router.js";
import { buildDefs } from "./markers.js";
import { svgEl, SvgAttrs } from "./svgUtil.js";
import { ResizeHandle, Guide } from "./snap.js";

function pointsToPath(pts: Point[]): string {
  return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
}

export const RESIZE_HANDLES: ResizeHandle[] = [
  "nw",
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
];
function handlePosition(
  handle: ResizeHandle,
  w: number,
  h: number,
): [number, number] {
  const x = handle.includes("w") ? 0 : handle.includes("e") ? w : w / 2;
  const y = handle.includes("n") ? 0 : handle.includes("s") ? h : h / 2;
  return [x, y];
}

export function shapeElement(
  g: SVGGElement,
  el: { w: number; h: number },
  def: ElementTypeDef,
): void {
  const { w, h } = el;
  const stroke = LAYERS[def.layer].stroke;
  const fill = LAYERS[def.layer].color;
  const common: SvgAttrs = {
    fill,
    stroke,
    "stroke-width": 1.5,
    class: "am-shape",
  };
  switch (def.shape) {
    case "oval": {
      g.appendChild(
        svgEl("ellipse", {
          cx: w / 2,
          cy: h / 2,
          rx: w / 2,
          ry: h / 2,
          ...common,
        }),
      );
      break;
    }
    case "rounded": {
      g.appendChild(
        svgEl("rect", {
          x: 0,
          y: 0,
          width: w,
          height: h,
          rx: 10,
          ry: 10,
          ...common,
        }),
      );
      break;
    }
    case "component": {
      g.appendChild(
        svgEl("rect", { x: 0, y: 0, width: w, height: h, ...common }),
      );
      for (const ty of [h * 0.22, h * 0.62]) {
        g.appendChild(
          svgEl("rect", {
            x: -8,
            y: ty,
            width: 16,
            height: 10,
            fill,
            stroke,
            "stroke-width": 1.3,
          }),
        );
      }
      break;
    }
    case "box3d": {
      const d = 10;
      g.appendChild(
        svgEl("path", {
          d: `M0,${d} L${d},0 L${w},0 L${w},${h - d} L${w - d},${h} L0,${h} Z`,
          ...common,
        }),
      );
      g.appendChild(
        svgEl("path", {
          d: `M0,${d} L${w - d},${d} L${w},0`,
          fill: "none",
          stroke,
          "stroke-width": 1,
        }),
      );
      g.appendChild(
        svgEl("path", {
          d: `M${w - d},${d} L${w - d},${h} M${w - d},${d} L${w},0`,
          fill: "none",
          stroke,
          "stroke-width": 1,
        }),
      );
      break;
    }
    case "chevron": {
      const nick = 14;
      g.appendChild(
        svgEl("path", {
          d: `M0,0 L${w - nick},0 L${w},${h / 2} L${w - nick},${h} L0,${h} L${nick},${h / 2} Z`,
          ...common,
        }),
      );
      break;
    }
    case "wavyrect": {
      g.appendChild(
        svgEl("rect", { x: 0, y: 0, width: w, height: h, ...common }),
      );
      break;
    }
    case "junction": {
      g.appendChild(
        svgEl("circle", {
          cx: w / 2,
          cy: h / 2,
          r: Math.min(w, h) / 2,
          fill: stroke,
          stroke,
        }),
      );
      break;
    }
    case "rect":
    default: {
      g.appendChild(
        svgEl("rect", { x: 0, y: 0, width: w, height: h, ...common }),
      );
    }
  }
}

// small top-right badge glyph indicating the element "family" (very small
// simplified line-icons — not full ArchiMate iconography, but visually
// distinct enough to tell layers/kinds apart at a glance).
export function badgeGlyph(def: ElementTypeDef): SVGGElement {
  const s = svgEl("g", { class: "am-badge" });
  const stroke = LAYERS[def.layer].stroke;
  const common: SvgAttrs = { fill: "none", stroke, "stroke-width": 1.3 };
  switch (def.badge) {
    case "actor":
      s.appendChild(svgEl("circle", { cx: 7, cy: 3, r: 2.4, ...common }));
      s.appendChild(
        svgEl("path", {
          d: "M7,5.6 L7,11 M3.5,8 L10.5,8 M7,11 L4,15 M7,11 L10,15",
          ...common,
        }),
      );
      break;
    case "process":
      s.appendChild(
        svgEl("path", { d: "M1,7 L11,7 M8,3.5 L12,7 L8,10.5", ...common }),
      );
      break;
    case "function":
      s.appendChild(
        svgEl("path", { d: "M3,2 L11,2 L11,11 L7,8 L3,11 Z", ...common }),
      );
      break;
    case "collaboration":
      s.appendChild(svgEl("circle", { cx: 5, cy: 7, r: 4, ...common }));
      s.appendChild(svgEl("circle", { cx: 9, cy: 7, r: 4, ...common }));
      break;
    case "interaction":
      s.appendChild(svgEl("path", { d: "M7,2 A5,5 0 0,0 7,12 Z", ...common }));
      s.appendChild(svgEl("path", { d: "M7,2 A5,5 0 0,1 7,12 Z", ...common }));
      break;
    case "component":
      s.appendChild(
        svgEl("rect", { x: 4, y: 2, width: 9, height: 10, ...common }),
      );
      s.appendChild(
        svgEl("rect", { x: 1.5, y: 4, width: 3.5, height: 2, ...common }),
      );
      s.appendChild(
        svgEl("rect", { x: 1.5, y: 8, width: 3.5, height: 2, ...common }),
      );
      break;
    case "service":
      s.appendChild(
        svgEl("rect", { x: 1, y: 3, width: 12, height: 8, rx: 4, ...common }),
      );
      break;
    case "interface":
      s.appendChild(svgEl("circle", { cx: 4, cy: 7, r: 3, ...common }));
      s.appendChild(svgEl("path", { d: "M7,7 L13,7", ...common }));
      break;
    case "object":
    case "artifact":
      s.appendChild(
        svgEl("rect", { x: 1, y: 1, width: 12, height: 12, ...common }),
      );
      s.appendChild(svgEl("path", { d: "M1,5 L13,5", ...common }));
      break;
    case "event":
      s.appendChild(
        svgEl("path", { d: "M1,3 L8,3 L13,7 L8,11 L1,11 Z", ...common }),
      );
      break;
    case "goal":
      s.appendChild(svgEl("circle", { cx: 7, cy: 7, r: 6, ...common }));
      s.appendChild(svgEl("circle", { cx: 7, cy: 7, r: 3, ...common }));
      break;
    case "requirement":
    case "principle":
    case "constraint":
      s.appendChild(svgEl("path", { d: "M2,12 L2,3 L12,3 L12,12", ...common }));
      s.appendChild(
        svgEl("path", { d: "M2,12 L12,12", stroke, "stroke-width": 2.2 }),
      );
      break;
    case "value":
    case "outcome":
    case "meaning":
      s.appendChild(svgEl("path", { d: "M7,1 L12,13 L1,13 Z", ...common }));
      break;
    case "capability":
    case "resource":
    case "course":
      s.appendChild(svgEl("circle", { cx: 7, cy: 7, r: 6, ...common }));
      s.appendChild(svgEl("path", { d: "M4,7 L10,7 M7,4 L7,10", ...common }));
      break;
    case "node":
    case "device":
    case "system":
    case "equipment":
    case "facility":
      s.appendChild(
        svgEl("path", { d: "M1,4 L5,1 L13,1 L13,9 L9,12 L1,12 Z", ...common }),
      );
      break;
    default:
      s.appendChild(svgEl("circle", { cx: 7, cy: 7, r: 6, ...common }));
  }
  return s;
}

export type ElementPointerHandler = (e: PointerEvent, id: string) => void;
export type EdgeClickHandler = (e: PointerEvent, id: string) => void;
export type HingePointerHandler = (
  e: PointerEvent,
  relId: string,
  end: "source" | "target",
) => void;
export type ResizeHandlePointerHandler = (
  e: PointerEvent,
  elId: string,
  handle: ResizeHandle,
) => void;
export type SegmentPointerHandler = (
  e: PointerEvent,
  relId: string,
  segIndex: number,
) => void;

export interface RendererCallbacks {
  onElementPointerDown?: ElementPointerHandler;
  onEdgeClick?: EdgeClickHandler;
  onHingePointerDown?: HingePointerHandler;
  onResizeHandlePointerDown?: ResizeHandlePointerHandler;
  onSegmentPointerDown?: SegmentPointerHandler;
}

export class Renderer {
  svg: SVGSVGElement;
  model: ArchimateModel;
  router = new OrthogonalRouter();
  viewport: SVGGElement;
  edgeLayer: SVGGElement;
  nodeLayer: SVGGElement;
  guideLayer: SVGGElement;
  elementDom = new Map<string, SVGGElement>();
  edgeDom = new Map<string, SVGGElement>();
  /** The polyline actually rendered for each edge as of the last renderEdge() call. */
  lastPoints = new Map<string, Point[]>();

  onElementPointerDown?: ElementPointerHandler;
  onEdgeClick?: EdgeClickHandler;
  onHingePointerDown?: HingePointerHandler;
  onResizeHandlePointerDown?: ResizeHandlePointerHandler;
  onSegmentPointerDown?: SegmentPointerHandler;

  constructor(
    svg: SVGSVGElement,
    model: ArchimateModel,
    callbacks: RendererCallbacks = {},
  ) {
    this.svg = svg;
    this.model = model;
    this.onElementPointerDown = callbacks.onElementPointerDown;
    this.onEdgeClick = callbacks.onEdgeClick;
    this.onHingePointerDown = callbacks.onHingePointerDown;
    this.onResizeHandlePointerDown = callbacks.onResizeHandlePointerDown;
    this.onSegmentPointerDown = callbacks.onSegmentPointerDown;
    buildDefs(svg);
    this.viewport = svgEl("g", { class: "am-viewport" });
    this.edgeLayer = svgEl("g", { class: "am-edges" });
    this.nodeLayer = svgEl("g", { class: "am-nodes" });
    this.guideLayer = svgEl("g", { class: "am-guides" });
    this.viewport.appendChild(this.edgeLayer);
    this.viewport.appendChild(this.nodeLayer);
    this.viewport.appendChild(this.guideLayer);
    svg.appendChild(this.viewport);
  }

  /** Draw PowerPoint-style alignment guide lines. */
  showGuides(guides: Guide[]): void {
    this.guideLayer.replaceChildren();
    for (const gd of guides) {
      const line =
        gd.type === "v"
          ? svgEl("line", { x1: gd.pos, y1: gd.from, x2: gd.pos, y2: gd.to })
          : svgEl("line", { x1: gd.from, y1: gd.pos, x2: gd.to, y2: gd.pos });
      line.setAttribute("class", "am-guide-line");
      this.guideLayer.appendChild(line);
    }
  }
  clearGuides(): void {
    this.guideLayer.replaceChildren();
  }

  fullRender(): void {
    this.router.resetLanes();
    this.edgeLayer.replaceChildren();
    this.nodeLayer.replaceChildren();
    this.elementDom.clear();
    this.edgeDom.clear();
    for (const el of this.model.elements.values()) this.renderElement(el);
    for (const rel of this.model.relationships.values()) this.renderEdge(rel);
  }

  renderElement(el: ArchimateElement): void {
    const def = ELEMENT_TYPES[el.type];
    const g = svgEl("g", {
      class: `am-element am-layer-${def.layer}`,
      transform: `translate(${el.x},${el.y})`,
      "data-id": el.id,
    });
    this._paintElement(g, el, def);
    if (this.onElementPointerDown)
      g.addEventListener("pointerdown", (e) =>
        this.onElementPointerDown!(e, el.id),
      );
    this.nodeLayer.appendChild(g);
    this.elementDom.set(el.id, g);
  }

  // (Re)draws everything inside an element's <g> from its current x/y/w/h.
  // Used for the initial render and again after a resize.
  private _paintElement(
    g: SVGGElement,
    el: ArchimateElement,
    def: ElementTypeDef = ELEMENT_TYPES[el.type],
  ): void {
    g.replaceChildren();
    shapeElement(g, el, def);
    if (def.badge) {
      const badge = badgeGlyph(def);
      badge.setAttribute("transform", `translate(${el.w - 22},3) scale(1.4)`);
      g.appendChild(badge);
    }
    const fo = svgEl("foreignObject", {
      x: 4,
      y: 2,
      width: Math.max(el.w - 8, 1),
      height: Math.max(el.h - 4, 1),
    });
    const div = document.createElement("div");
    div.className = "am-label";
    div.textContent = el.name;
    fo.appendChild(div);
    g.appendChild(fo);
    const typeLabel = svgEl("text", {
      x: 4,
      y: el.h - 4,
      class: "am-type-label",
    });
    typeLabel.textContent = humanize(el.type);
    g.appendChild(typeLabel);
    for (const handle of RESIZE_HANDLES) {
      const [hx, hy] = handlePosition(handle, el.w, el.h);
      const size = 7;
      const rect = svgEl("rect", {
        class: `am-resize-handle am-resize-${handle}`,
        "data-handle": handle,
        x: hx - size / 2,
        y: hy - size / 2,
        width: size,
        height: size,
      });
      if (this.onResizeHandlePointerDown) {
        rect.addEventListener("pointerdown", (e) => {
          e.stopPropagation();
          this.onResizeHandlePointerDown!(e, el.id, handle);
        });
      }
      g.appendChild(rect);
    }
  }

  updateElementLabel(el: ArchimateElement): void {
    const g = this.elementDom.get(el.id);
    if (!g) return;
    const div = g.querySelector<HTMLDivElement>(".am-label");
    if (div) div.textContent = el.name;
  }

  moveElementDom(el: ArchimateElement): void {
    const g = this.elementDom.get(el.id);
    if (g) g.setAttribute("transform", `translate(${el.x},${el.y})`);
  }

  // Repaints an element after its w/h (and possibly x/y) changed, e.g. resize.
  updateElementGeometry(el: ArchimateElement): void {
    const g = this.elementDom.get(el.id);
    if (!g) return;
    g.setAttribute("transform", `translate(${el.x},${el.y})`);
    this._paintElement(g, el);
  }

  removeElementDom(id: string): void {
    const g = this.elementDom.get(id);
    if (g) g.remove();
    this.elementDom.delete(id);
  }

  removeEdgeDom(id: string): void {
    const g = this.edgeDom.get(id);
    if (g) g.remove();
    this.edgeDom.delete(id);
    this.lastPoints.delete(id);
    this.router.releaseEdge(id);
  }

  obstaclesExcept(...ids: string[]) {
    const skip = new Set(ids);
    return [...this.model.elements.values()]
      .filter((e) => !skip.has(e.id))
      .map((e) => e.bounds());
  }

  renderEdge(rel: ArchimateRelationship): Point[] | undefined {
    const src = this.model.getElement(rel.source);
    const tgt = this.model.getElement(rel.target);
    if (!src || !tgt) return;
    const def = RELATIONSHIP_TYPES[rel.type];
    let g = this.edgeDom.get(rel.id);
    if (!g) {
      g = svgEl("g", { class: "am-edge", "data-id": rel.id });
      const hit = svgEl("path", {
        class: "am-edge-hit",
        fill: "none",
        stroke: "transparent",
        "stroke-width": 14,
      });
      const line = svgEl("path", { class: "am-edge-line", fill: "none" });
      g.appendChild(hit);
      g.appendChild(line);
      const labelGroup = svgEl("g", { class: "am-edge-label" });
      const labelBg = svgEl("rect", { class: "am-edge-label-bg" });
      const labelText = svgEl("text", { class: "am-edge-label-text" });
      labelGroup.appendChild(labelBg);
      labelGroup.appendChild(labelText);
      g.appendChild(labelGroup);
      const sourceHandle = svgEl("circle", {
        class: "am-edge-handle",
        r: 5,
        "data-end": "source",
      });
      const targetHandle = svgEl("circle", {
        class: "am-edge-handle",
        r: 5,
        "data-end": "target",
      });
      if (this.onHingePointerDown) {
        sourceHandle.addEventListener("pointerdown", (e) => {
          e.stopPropagation();
          this.onHingePointerDown!(e, rel.id, "source");
        });
        targetHandle.addEventListener("pointerdown", (e) => {
          e.stopPropagation();
          this.onHingePointerDown!(e, rel.id, "target");
        });
      }
      g.appendChild(sourceHandle);
      g.appendChild(targetHandle);
      if (this.onEdgeClick)
        g.addEventListener("pointerdown", (e) => {
          e.stopPropagation();
          this.onEdgeClick!(e, rel.id);
        });
      this.edgeLayer.appendChild(g);
      this.edgeDom.set(rel.id, g);
    }
    const pts =
      rel.bendpoints && rel.bendpoints.length
        ? rel.bendpoints
        : this.router.routeEdge(
            rel.id,
            src.bounds(),
            tgt.bounds(),
            this.obstaclesExcept(src.id, tgt.id),
            { sourcePort: rel.sourcePort, targetPort: rel.targetPort },
          );
    this.lastPoints.set(rel.id, pts);
    const d = pointsToPath(pts);
    const sourceHandle = g.querySelector('.am-edge-handle[data-end="source"]')!;
    const targetHandle = g.querySelector('.am-edge-handle[data-end="target"]')!;
    sourceHandle.setAttribute("cx", String(pts[0].x));
    sourceHandle.setAttribute("cy", String(pts[0].y));
    targetHandle.setAttribute("cx", String(pts[pts.length - 1].x));
    targetHandle.setAttribute("cy", String(pts[pts.length - 1].y));
    this._paintSegmentHandles(g, rel.id, pts);
    const line = g.querySelector(".am-edge-line")!;
    const hit = g.querySelector(".am-edge-hit")!;
    line.setAttribute("d", d);
    hit.setAttribute("d", d);
    line.setAttribute(
      "stroke-dasharray",
      def.style === "dashed"
        ? "7,4"
        : def.style === "dotted"
          ? "1.5,3.5"
          : "none",
    );
    if (def.endMarker)
      line.setAttribute("marker-end", `url(#am-${def.endMarker})`);
    else line.removeAttribute("marker-end");
    if (def.startMarker)
      line.setAttribute("marker-start", `url(#am-${def.startMarker})`);
    else line.removeAttribute("marker-start");

    const labelGroup = g.querySelector<SVGGElement>(".am-edge-label")!;
    const labelBg = g.querySelector<SVGRectElement>(".am-edge-label-bg")!;
    const labelText = g.querySelector<SVGTextElement>(".am-edge-label-text")!;
    const text = rel.name || "";
    if (text) {
      const pos = labelPosition(pts);
      labelText.textContent = text;
      labelGroup.style.display = "";
      // measure after setting text via getBBox on next frame-safe path: set then read
      labelGroup.setAttribute("transform", `translate(${pos.x},${pos.y})`);
      requestAnimationFrameSafe(() => {
        try {
          const bbox = labelText.getBBox();
          labelBg.setAttribute("x", String(bbox.x - 4));
          labelBg.setAttribute("y", String(bbox.y - 2));
          labelBg.setAttribute("width", String(bbox.width + 8));
          labelBg.setAttribute("height", String(bbox.height + 4));
        } catch {
          /* not attached yet */
        }
      });
    } else {
      labelGroup.style.display = "none";
    }
    return pts;
  }

  // Places a draggable handle at the midpoint of every segment, including
  // the first/last ones that touch the source/target hinge — dragging those
  // slides the hinge along its element's boundary together with the bend,
  // same axis-locked perpendicular move as any other segment.
  private _paintSegmentHandles(
    g: SVGGElement,
    relId: string,
    pts: Point[],
  ): void {
    for (const old of g.querySelectorAll(".am-segment-handle")) old.remove();
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i],
        b = pts[i + 1];
      const horizontal = a.y === b.y;
      const mx = (a.x + b.x) / 2,
        my = (a.y + b.y) / 2;
      const w = horizontal ? 16 : 8;
      const h = horizontal ? 8 : 16;
      const handle = svgEl("rect", {
        class: `am-segment-handle ${horizontal ? "am-segment-h" : "am-segment-v"}`,
        x: mx - w / 2,
        y: my - h / 2,
        width: w,
        height: h,
        rx: 3,
      });
      if (this.onSegmentPointerDown) {
        handle.addEventListener("pointerdown", (e) => {
          e.stopPropagation();
          this.onSegmentPointerDown!(e, relId, i);
        });
      }
      g.appendChild(handle);
    }
  }

  // reroute only edges touching the given element id (used while dragging)
  rerouteConnected(elementId: string): void {
    for (const rel of this.model.relationships.values()) {
      if (rel.source === elementId || rel.target === elementId) {
        // A manual bendpoints route is an absolute polyline tailored to this
        // element's old position; once it moves, that polyline no longer
        // lines up with its boundary. Drop it so the router lays out a
        // fresh path (still respecting a pinned sourcePort/targetPort, if
        // set) instead of leaving a frozen, now-disconnected line behind.
        rel.bendpoints = null;
        this.renderEdge(rel);
      }
    }
  }

  rerouteAll({
    preserveManual = true,
  }: { preserveManual?: boolean } = {}): void {
    this.router.resetLanes();
    for (const rel of this.model.relationships.values()) {
      if (preserveManual && rel.bendpoints && rel.bendpoints.length) continue;
      this.renderEdge(rel);
    }
  }

  setSelected(ids: Set<string>): void {
    for (const [id, g] of this.elementDom)
      g.classList.toggle("am-selected", ids.has(id));
    for (const [id, g] of this.edgeDom)
      g.classList.toggle("am-selected", ids.has(id));
  }
}

function requestAnimationFrameSafe(fn: () => void): void {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(fn);
  else fn();
}
function humanize(type: string): string {
  return type.replace(/([a-z])([A-Z])/g, "$1 $2");
}
