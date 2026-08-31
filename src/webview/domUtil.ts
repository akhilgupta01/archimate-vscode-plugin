// Small shared HTML DOM helper used across the webview UI modules.

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  attrs: Record<string, string> = {}
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}
