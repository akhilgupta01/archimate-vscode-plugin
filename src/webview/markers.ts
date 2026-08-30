// Shared SVG <marker> definitions for relationship arrowheads/diamonds.
// Used both by the canvas renderer and by small palette relationship icons
// (marker url() references resolve document-wide, so one <defs> suffices).

import { svgEl } from './svgUtil.js';

interface MarkerDef {
  id: string;
  w: number;
  h: number;
  refX: number;
  path: string;
  fill?: boolean | 'white';
  openStroke?: boolean;
}

export const MARKER_DEFS: MarkerDef[] = [
  { id: 'am-diamond-filled', w: 20, h: 12, refX: 20, path: 'M0,6 L10,0 L20,6 L10,12 Z', fill: true },
  { id: 'am-diamond-hollow', w: 20, h: 12, refX: 20, path: 'M0,6 L10,0 L20,6 L10,12 Z', fill: false },
  { id: 'am-dot-filled', w: 14, h: 14, refX: 14, path: 'M7,1 A6,6 0 1,1 6.99,1 Z', fill: true },
  { id: 'am-arrow-open', w: 12, h: 12, refX: 11, path: 'M1,1 L11,6 L1,11', fill: false, openStroke: true },
  { id: 'am-arrow-hollow', w: 16, h: 12, refX: 15, path: 'M1,1 L15,6 L1,11 Z', fill: 'white' },
  { id: 'am-arrow-line', w: 12, h: 12, refX: 11, path: 'M1,1 L11,6 L1,11', fill: false, openStroke: true },
  { id: 'am-arrow-line-small', w: 9, h: 9, refX: 8, path: 'M1,1 L8,4.5 L1,8', fill: false, openStroke: true },
  { id: 'am-arrow-filled', w: 12, h: 12, refX: 11, path: 'M1,1 L11,6 L1,11 Z', fill: true },
];

export function buildDefs(svg: SVGSVGElement): SVGDefsElement {
  const existing = svg.querySelector('defs');
  if (existing) return existing;
  const defs = svgEl('defs');
  for (const m of MARKER_DEFS) {
    const marker = svgEl('marker', {
      id: m.id, viewBox: `0 0 ${m.w} ${m.h}`, refX: m.refX, refY: m.h / 2,
      markerWidth: m.w, markerHeight: m.h, orient: 'auto-start-reverse', markerUnits: 'userSpaceOnUse',
    });
    const path = svgEl('path', { d: m.path, class: 'am-marker-path' });
    if (m.fill === true) path.setAttribute('fill', 'currentColor');
    else if (m.fill === 'white') { path.setAttribute('fill', 'var(--am-canvas-bg,#fff)'); path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '1.5'); }
    else path.setAttribute('fill', 'none');
    if (m.openStroke) { path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '1.6'); path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round'); }
    if (!m.fill && !m.openStroke) path.setAttribute('stroke', 'currentColor');
    marker.appendChild(path);
    defs.appendChild(marker);
  }
  svg.appendChild(defs);
  return defs;
}

let _sharedDefsInjected = false;
// Ensures the marker defs exist somewhere in the document even before the
// canvas <svg> is built, so standalone palette icons can reference them.
export function ensureSharedDefs(): void {
  if (_sharedDefsInjected || document.getElementById('am-shared-defs-root')) { _sharedDefsInjected = true; return; }
  const holder = svgEl('svg', { id: 'am-shared-defs-root', width: 0, height: 0, style: 'position:absolute;overflow:hidden' });
  buildDefs(holder);
  document.body.appendChild(holder);
  _sharedDefsInjected = true;
}
