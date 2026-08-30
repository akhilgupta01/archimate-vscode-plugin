// Storage adapter used inside the real VS Code extension: proxies every
// call to the extension host via postMessage, since the webview itself has
// no filesystem access. The host (src/extension.ts) does the actual
// fs.readFile/writeFile/rename work and replies with the same request id.

import type { StorageAdapter, ViewData, TreeEntry, Settings } from './StorageAdapter.js';
import type { RpcRequest, RpcResponse, RpcMethod } from '../../protocol.js';

interface VsCodeApi { postMessage(message: unknown): void; }
declare function acquireVsCodeApi(): VsCodeApi;

export class VSCodeAdapter implements StorageAdapter {
  private vscode: VsCodeApi;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();

  constructor() {
    this.vscode = acquireVsCodeApi();
    window.addEventListener('message', (event: MessageEvent<RpcResponse>) => {
      const { id, ok, result, error } = event.data || ({} as RpcResponse);
      const entry = this.pending.get(id);
      if (!entry) return;
      this.pending.delete(id);
      if (ok) entry.resolve(result); else entry.reject(new Error(error || 'Unknown error'));
    });
  }

  private call<T>(method: RpcMethod, params?: Record<string, unknown>): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const req: RpcRequest = { id, method, params };
      this.vscode.postMessage(req);
    });
  }

  getSettings(): Promise<Settings> { return this.call('getSettings'); }
  updateSettings(patch: Partial<Settings>): Promise<Settings> { return this.call('updateSettings', patch); }
  listTree(): Promise<TreeEntry[]> { return this.call<{ entries: TreeEntry[] }>('listTree').then(r => r.entries); }
  readView(path: string): Promise<ViewData> { return this.call('readView', { path }); }
  writeView(path: string, data: ViewData): Promise<{ path: string; updatedAt: number }> { return this.call('writeView', { path, data }); }
  writeExternalView(data: ViewData): Promise<{ ok: boolean }> { return this.call('writeExternalView', { data }); }
  createFolder(path: string): Promise<void> { return this.call('createFolder', { path }); }
  deleteFolder(path: string): Promise<void> { return this.call('deleteFolder', { path }); }
  deleteView(path: string): Promise<void> { return this.call('deleteView', { path }); }
  rename(fromPath: string, toPath: string): Promise<void> { return this.call('rename', { from: fromPath, to: toPath }); }
}
