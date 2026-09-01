// Entry point for the ArchiMate Model Tree sidebar view (a separate
// WebviewView in its own Activity Bar container — a distinct icon in the
// primary sidebar, not stacked under the Palette) — bundled to
// dist/modelTree.js. Lists every element ever placed on any view (see
// ModelElementRecord in model.ts) so one can be organized into subfolders
// or dragged into a *different* view to reuse it there.
//
// Unlike the Palette/Inspector, this view owns a full VSCodeAdapter of its
// own (not just an "arm this tool" postMessage relay) — organizing the
// Model Tree (create/rename/move/delete folders) shouldn't require a
// Designer canvas to be open at all. Placing an element *onto* the canvas
// still goes through the same arm-then-click relay the Palette uses, since
// that's the one thing genuinely tied to a specific open canvas webview.

import { ModelTreeController } from './modelTreeView.js';
import { VSCodeAdapter, VsCodeApi } from './storage/VSCodeAdapter.js';
import type { ModelTreeNode } from './storage/StorageAdapter.js';

declare function acquireVsCodeApi(): VsCodeApi;
const vscode = acquireVsCodeApi();
const storage = new VSCodeAdapter(vscode);

const root = document.getElementById('app');
if (!root) throw new Error('#app root not found');
root.classList.add('am-palette');

const controller = new ModelTreeController({
  storage,
  onPlace: (record) => {
    vscode.postMessage({ type: 'archiModelElementArm', record });
  },
  // No onDropOnCanvas/isOverCanvas here — this webview is isolated from the
  // Designer canvas's own webview, so a drag can never land there directly;
  // onPlace's click-then-click-the-canvas relay is the only way in.
});
root.append(controller.searchInput, controller.scroll);
controller.render([]);

storage.listModelTree().then(nodes => controller.render(nodes)).catch(() => { /* best-effort */ });

window.addEventListener('message', (event: MessageEvent) => {
  const d = event.data;
  if (!d || d.type !== 'archiModelElementsChanged') return;
  controller.render((d.nodes ?? []) as ModelTreeNode[]);
});
