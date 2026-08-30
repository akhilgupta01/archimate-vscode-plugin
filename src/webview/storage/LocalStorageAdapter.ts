// Storage adapter backed by the browser's localStorage. Zero-setup fallback
// used by the standalone dev-preview harness (preview/index.html) when
// there's no VS Code extension host to talk to. Not used by the real
// extension — see VSCodeAdapter for that.

import type { StorageAdapter, ViewData, TreeEntry, Settings } from './StorageAdapter.js';

type Entry =
  | { type: 'folder' }
  | { type: 'view'; data: ViewData; updatedAt: number };

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
    return Object.entries(state.entries).map(([p, e]) => {
      const parentPath = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : null;
      const name = p.includes('/') ? p.slice(p.lastIndexOf('/') + 1) : p;
      return e.type === 'folder'
        ? { type: 'folder' as const, path: p, name, parentPath }
        : { type: 'view' as const, path: p, name, parentPath, updatedAt: e.updatedAt };
    });
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
}
