// Entry point for the ArchiMate Palette sidebar view (a separate
// WebviewView, registered by extension.ts in its own Activity Bar
// container) — bundled to dist/palette.js. Lets the palette live alongside
// the Explorer and Copilot Chat instead of eating space inside the main
// designer's canvas.
//
// VS Code webviews are isolated contexts, so native drag-and-drop from here
// onto the designer's canvas (a different webview) isn't possible. Instead,
// clicking a tool "arms" it (posted to the extension host, which relays it
// to the designer panel); the designer places the element (or starts a
// relationship draw) on the next canvas click, then echoes the cleared
// state back so this view's highlight stays in sync. See
// ArchimateDesigner's `hostApi` option and `_armTool` in designer.ts.

import { buildPaletteDom } from './paletteView.js';

interface VsCodeApi { postMessage(message: unknown): void; }
declare function acquireVsCodeApi(): VsCodeApi;
const vscode = acquireVsCodeApi();

const root = document.getElementById('app');
if (!root) throw new Error('#app root not found');
root.classList.add('am-palette');

const { searchInput, scroll, elementButtons, relButtons } = buildPaletteDom();
root.appendChild(searchInput);
root.appendChild(scroll);

let armedKind: 'element' | 'relationship' | null = null;
let armedType: string | null = null;

function clearActive(): void {
  scroll.querySelectorAll('.am-icon-btn.am-active').forEach((b) => b.classList.remove('am-active'));
}

function arm(kind: 'element' | 'relationship', type: string, btn: HTMLElement): void {
  const already = armedKind === kind && armedType === type;
  clearActive();
  if (already) {
    armedKind = null;
    armedType = null;
  } else {
    armedKind = kind;
    armedType = type;
    btn.classList.add('am-active');
  }
  vscode.postMessage({ type: 'archiToolArm', kind, archiType: type });
}

for (const [type, btn] of relButtons) btn.addEventListener('click', () => arm('relationship', type, btn));
for (const [type, btn] of elementButtons) btn.addEventListener('click', () => arm('element', type, btn));

// The designer echoes its armed/cleared state back (after placing an
// element, completing/cancelling a relationship draw, or Esc) so our
// highlight never drifts out of sync with what's actually armed over there.
window.addEventListener('message', (event: MessageEvent) => {
  const d = event.data;
  if (!d || d.type !== 'archiToolArmedChanged') return;
  armedKind = d.kind ?? null;
  armedType = d.archiType ?? null;
  clearActive();
  if (armedKind && armedType) {
    const btn = scroll.querySelector<HTMLElement>(`.am-icon-btn[data-kind="${armedKind}"][data-type="${armedType}"]`);
    btn?.classList.add('am-active');
  }
});
