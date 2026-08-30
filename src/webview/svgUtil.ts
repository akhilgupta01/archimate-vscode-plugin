// Small shared SVG DOM helpers used across renderer/icons/markers/designer.

export const SVG_NS = 'http://www.w3.org/2000/svg';
export type SvgAttrs = Record<string, string | number>;

export function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: SvgAttrs = {}): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag) as SVGElementTagNameMap[K];
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  return e;
}
