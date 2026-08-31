// Shared inspector form builder: title + Name/Label field + (element only)
// Documentation field, or (relationship only) an "Auto-route again" button.
// Used by both the real VS Code sidebar (inspectorMain.ts, posts edits to
// the extension host) and the standalone dev-preview harness's embedded
// dock (designer.ts, mutates the model directly) — both funnel edits
// through the same `final` flag (live keystroke vs. committed change) so a
// single callback shape covers both.

import { el } from './domUtil.js';
import { humanize } from './paletteData.js';

export type Selection =
  | { kind: 'element'; id: string; type: string; name: string; documentation: string }
  | { kind: 'relationship'; id: string; type: string; name: string }
  | null;

export const INSPECTOR_EMPTY_HTML = '<div class="am-inspector-empty">Select an element or relationship to edit its properties.</div>';

export interface InspectorCallbacks {
  onEdit(id: string, field: 'name' | 'documentation', value: string, final: boolean): void;
  onReroute(id: string): void;
}

export function renderInspectorDom(root: HTMLElement, selection: Selection, cb: InspectorCallbacks): void {
  root.innerHTML = '';
  if (!selection) {
    root.innerHTML = INSPECTOR_EMPTY_HTML;
    return;
  }

  const title = el('div', 'am-inspector-title');
  title.textContent = humanize(selection.type);

  const nameLabel = el('label', 'am-field-label');
  nameLabel.textContent = selection.kind === 'relationship' ? 'Label' : 'Name';
  const nameInput = el('input', 'am-field-input');
  nameInput.placeholder = selection.kind === 'relationship' ? 'Unlabeled' : 'Unnamed';
  nameInput.value = selection.name;
  nameInput.addEventListener('input', () => cb.onEdit(selection.id, 'name', nameInput.value, false));
  nameInput.addEventListener('change', () => cb.onEdit(selection.id, 'name', nameInput.value, true));
  root.append(title, nameLabel, nameInput);

  if (selection.kind === 'element') {
    const docLabel = el('label', 'am-field-label');
    docLabel.textContent = 'Documentation';
    const docInput = el('textarea', 'am-field-textarea');
    docInput.placeholder = 'Add documentation…';
    docInput.value = selection.documentation;
    docInput.addEventListener('change', () => cb.onEdit(selection.id, 'documentation', docInput.value, true));
    root.append(docLabel, docInput);
  } else {
    const rerouteBtn = el('button', 'am-btn');
    rerouteBtn.textContent = 'Auto-route again';
    rerouteBtn.title = 'Clear manual bend/hinge points and let the router pick again';
    rerouteBtn.addEventListener('click', () => cb.onReroute(selection.id));
    root.appendChild(rerouteBtn);
  }
}
