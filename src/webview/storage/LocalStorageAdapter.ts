// Storage adapter backed by the browser's localStorage. Zero-setup fallback
// used by the standalone dev-preview harness (preview/index.html) when
// there's no VS Code extension host to talk to. Not used by the real
// extension — see VSCodeAdapter for that.

import type { StorageAdapter, ViewData, TreeEntry, Settings, ModelTreeNode } from './StorageAdapter.js';
import type { ModelElementRecord } from '../model.js';
import { LAYERS, modelElementFolder } from '../model.js';

// Model Tree records live under these 7 reserved top-level names, same as
// the real filesystem backend (fsBackend.ts) — kept in sync with it so
// listTree()/listModelTree() agree on which top-level entries are "Views"
// vs. "Model Tree" content sharing the same flat path-keyed map.
const MODEL_TREE_FOLDER_NAMES = new Set(Object.values(LAYERS).map(l => l.label));

type Entry =
  | { type: 'folder' }
  | { type: 'view'; data: ViewData; updatedAt: number }
  | { type: 'element'; record: ModelElementRecord };

interface State { entries: Record<string, Entry>; }

export class LocalStorageAdapter implements StorageAdapter {
  private storageKey: string;

  constructor({ storageKey = 'archimate-designer' }: { storageKey?: string } = {}) {
    this.storageKey = storageKey;
  }

  private key(): string { return `${this.storageKey}:fs`; }

  private read(): State {
    try { return JSON.parse(localStorage.getItem(this.key()) || '') || { entries: {} }; }
    catch { return { entries: {} }; }
  }
  private write(state: State): void {
    try { localStorage.setItem(this.key(), JSON.stringify(state)); } catch { /* storage unavailable */ }
  }

  async getSettings(): Promise<Settings> { return {}; }
  async updateSettings(): Promise<Settings> { return {}; }

  async listTree(): Promise<TreeEntry[]> {
    const state = this.read();
    const entries: TreeEntry[] = [];
    for (const [p, e] of Object.entries(state.entries)) {
      if (e.type === 'element') continue; // Model Tree content — see listModelTree()
      const top = p.slice(0, p.indexOf('/') === -1 ? p.length : p.indexOf('/'));
      if (MODEL_TREE_FOLDER_NAMES.has(top)) continue; // reserved for the Model Tree, not a real view folder
      const parentPath = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : null;
      const name = p.includes('/') ? p.slice(p.lastIndexOf('/') + 1) : p;
      entries.push(e.type === 'folder'
        ? { type: 'folder', path: p, name, parentPath }
        : { type: 'view', path: p, name, parentPath, updatedAt: e.updatedAt });
    }
    return entries;
  }

  async readView(path: string): Promise<ViewData> {
    const e = this.read().entries[path];
    if (!e || e.type !== 'view') throw new Error(`View not found: ${path}`);
    return e.data;
  }

  async writeView(path: string, data: ViewData): Promise<{ path: string; updatedAt: number }> {
    const state = this.read();
    const updatedAt = Date.now();
    state.entries[path] = { type: 'view', data, updatedAt };
    this.write(state);
    return { path, updatedAt };
  }

  async writeExternalView(): Promise<{ ok: boolean }> {
    throw new Error('External file operations are not supported in preview mode');
  }

  async createFolder(path: string): Promise<void> {
    const state = this.read();
    state.entries[path] = { type: 'folder' };
    this.write(state);
  }

  async rename(fromPath: string, toPath: string): Promise<void> {
    const state = this.read();
    const prefix = `${fromPath}/`;
    const next: Record<string, Entry> = {};
    for (const [p, e] of Object.entries(state.entries)) {
      if (p === fromPath) next[toPath] = e;
      else if (p.startsWith(prefix)) next[`${toPath}/${p.slice(prefix.length)}`] = e;
      else next[p] = e;
    }
    this.write({ entries: next });
  }

  // Deletes a folder, reparenting its direct children (and everything
  // nested under them) up to the folder's own parent.
  async deleteFolder(path: string): Promise<void> {
    const state = this.read();
    const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : null;
    const prefix = `${path}/`;
    const next: Record<string, Entry> = {};
    for (const [p, e] of Object.entries(state.entries)) {
      if (p === path) continue;
      if (p.startsWith(prefix)) {
        const rest = p.slice(prefix.length);
        next[parentPath ? `${parentPath}/${rest}` : rest] = e;
      } else {
        next[p] = e;
      }
    }
    this.write({ entries: next });
  }

  async deleteView(path: string): Promise<void> {
    const state = this.read();
    delete state.entries[path];
    this.write(state);
  }

  // ---------- Model Tree ----------
  // Elements live in the *same* flat entries map as Views/folders, under
  // one of the 7 reserved top-level names — so createFolder/rename/
  // deleteFolder (above) already work for organizing them into subfolders
  // without any Model-Tree-specific logic; listModelTree() just filters
  // the same map down to what's under a reserved name.
  async listModelTree(): Promise<ModelTreeNode[]> {
    const state = this.read();
    const nodes: ModelTreeNode[] = [];
    for (const [p, e] of Object.entries(state.entries)) {
      const slash = p.indexOf('/');
      const top = slash === -1 ? p : p.slice(0, slash);
      if (!MODEL_TREE_FOLDER_NAMES.has(top)) continue;
      const parentPath = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : top;
      const name = p.includes('/') ? p.slice(p.lastIndexOf('/') + 1) : p;
      if (e.type === 'folder') nodes.push({ type: 'folder', path: p, name, parentPath });
      else if (e.type === 'element') nodes.push({ type: 'element', path: p, name: e.record.name, parentPath, record: e.record });
    }
    return nodes;
  }

  // Finds the existing entry for this element id anywhere under its layer
  // (it may have been organized into a subfolder) and updates it in place;
  // otherwise creates it fresh at the layer root. Mirrors fsBackend.ts's
  // writeModelElement so both adapters behave the same way.
  async writeModelElement(record: ModelElementRecord): Promise<void> {
    const state = this.read();
    const existingPath = Object.keys(state.entries).find(p => {
      const e = state.entries[p];
      return e.type === 'element' && e.record.id === record.id;
    });
    const layerName = LAYERS[modelElementFolder(record.type)].label;
    const targetPath = existingPath ?? `${layerName}/${record.id}`;
    state.entries[targetPath] = { type: 'element', record };
    this.write(state);
  }
}
