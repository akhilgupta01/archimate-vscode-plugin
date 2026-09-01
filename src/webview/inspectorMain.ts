// Entry point for the ArchiMate Inspector sidebar view (a separate
// WebviewView, stacked under the Palette in the same Activity Bar
// container) — bundled to dist/inspector.js. Moves the properties form out
// of the designer's own canvas-adjacent dock and into a real VS Code
// sidebar, freeing the full canvas width.
//
// Like the Palette, this is a separate, isolated webview from the designer
// canvas, so it can't read the model directly: the extension host relays
// `archiSelectionChanged` (designer -> here, what's selected right now) and
// this view posts back `archiInspectorEdit` / `archiInspectorReroute` /
// `archiInspectorReset` for
// the designer to apply. See ArchimateDesigner's `hostApi` handling in
// designer.ts (`_notifySelectionChanged`, `_applyInspectorEdit`,
// `_applyInspectorReroute`).

import { renderInspectorDom, Selection } from './inspectorView.js';

interface VsCodeApi { postMessage(message: unknown): void; }
declare function acquireVsCodeApi(): VsCodeApi;
const vscode = acquireVsCodeApi();

const root = document.getElementById('app');
if (!root) throw new Error('#app root not found');
root.classList.add('am-inspector');

function render(selection: Selection): void {
  renderInspectorDom(root!, selection, {
    onEdit: (id, field, value, final) => {
      vscode.postMessage({ type: 'archiInspectorEdit', id, field, value, final });
    },
    onReroute: (id) => {
      vscode.postMessage({ type: 'archiInspectorReroute', id });
    },
    onResetAppearance: (id) => {
      vscode.postMessage({ type: 'archiInspectorReset', id });
    },
  });
}

render(null);

window.addEventListener('message', (event: MessageEvent) => {
  const d = event.data;
  if (!d || d.type !== 'archiSelectionChanged') return;
  render(d.selection ?? null);
});
