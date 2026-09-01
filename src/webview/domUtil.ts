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

/** A VS Code codicon (see https://microsoft.github.io/vscode-codicons/dist/codicon.html) as a <span>, for UI chrome (buttons, carets, tree icons) that used to be a hand-drawn SVG or a Unicode/emoji glyph. */
export function codicon(name: string, extraCls?: string): HTMLSpanElement {
  return el("span", `codicon codicon-${name}${extraCls ? ` ${extraCls}` : ""}`);
}
