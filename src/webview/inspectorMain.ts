// Entry point for the ArchiMate Inspector sidebar view (a separate
// WebviewView, stacked under the Palette in the same Activity Bar
// container) — bundled to dist/inspector.js. Moves the properties form out
// of the designer's own canvas-adjacent dock and into a real VS Code
// sidebar, freeing the full canvas width.
//
// Like the Palette, this is a separate, isolated webview from the designer
// canvas, so it can't read the model directly: the extension host relays
// `archiSelectionChanged` (designer -> here, what's selected right now) and
// this view posts back `archiInspectorEdit` / `archiInspectorReroute` for
// the designer to apply. See ArchimateDesigner's `hostApi` handling in
// designer.ts (`_notifySelectionChanged`, `_applyInspectorEdit`,
// `_applyInspectorReroute`).

interface VsCodeApi { postMessage(message: unknown): void; }
declare function acquireVsCodeApi(): VsCodeApi;
const vscode = acquireVsCodeApi();

const root = document.getElementById('app');
if (!root) throw new Error('#app root not found');
root.classList.add('am-inspector');

type InspectorSelection =
  | { kind: 'element'; id: string; type: string; name: string; documentation: string }
  | { kind: 'relationship'; id: string; type: string; name: string }
  | null;

function humanize(type: string): string {
  return type.replace(/([a-z])([A-Z])/g, '$1 $2');
}

function render(selection: InspectorSelection): void {
  root!.innerHTML = '';
  if (!selection) {
    const empty = document.createElement('div');
    empty.className = 'am-inspector-empty';
    empty.textContent = 'Select an element or relationship to edit its properties.';
    root!.appendChild(empty);
    return;
  }

  const title = document.createElement('div');
  title.className = 'am-inspector-title';
  title.textContent = humanize(selection.type);

  const nameLabel = document.createElement('label');
  nameLabel.className = 'am-field-label';
  nameLabel.textContent = selection.kind === 'relationship' ? 'Label' : 'Name';
  const nameInput = document.createElement('input');
  nameInput.className = 'am-field-input';
  nameInput.placeholder = selection.kind === 'relationship' ? 'Unlabeled' : 'Unnamed';
  nameInput.value = selection.name;
  nameInput.addEventListener('input', () => {
    vscode.postMessage({ type: 'archiInspectorEdit', id: selection.id, field: 'name', value: nameInput.value, final: false });
  });
  nameInput.addEventListener('change', () => {
    vscode.postMessage({ type: 'archiInspectorEdit', id: selection.id, field: 'name', value: nameInput.value, final: true });
  });
  root!.append(title, nameLabel, nameInput);

  if (selection.kind === 'element') {
    const docLabel = document.createElement('label');
    docLabel.className = 'am-field-label';
    docLabel.textContent = 'Documentation';
    const docInput = document.createElement('textarea');
    docInput.className = 'am-field-textarea';
    docInput.placeholder = 'Add documentation…';
    docInput.value = selection.documentation;
    docInput.addEventListener('change', () => {
      vscode.postMessage({ type: 'archiInspectorEdit', id: selection.id, field: 'documentation', value: docInput.value, final: true });
    });
    root!.append(docLabel, docInput);
  } else {
    const rerouteBtn = document.createElement('button');
    rerouteBtn.className = 'am-btn';
    rerouteBtn.textContent = 'Auto-route again';
    rerouteBtn.title = 'Clear manual bend/hinge points and let the router pick again';
    rerouteBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'archiInspectorReroute', id: selection.id });
    });
    root!.appendChild(rerouteBtn);
  }
}

render(null);

window.addEventListener('message', (event: MessageEvent) => {
  const d = event.data;
  if (!d || d.type !== 'archiSelectionChanged') return;
  render(d.selection ?? null);
});
