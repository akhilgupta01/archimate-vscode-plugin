// Message wire format between the webview (src/webview/storage/VSCodeAdapter.ts)
// and the extension host (src/extension.ts), which owns filesystem access.
// Params/results are loosely typed here (both ends type their own side
// strictly via StorageAdapter); this is just the RPC envelope.

export type RpcMethod =
  | 'getSettings' | 'updateSettings' | 'listTree' | 'readView'
  | 'writeView' | 'writeExternalView' | 'createFolder' | 'deleteFolder' | 'deleteView' | 'rename';

export interface RpcRequest {
  id: number;
  method: RpcMethod;
  params?: Record<string, unknown>;
}

export interface RpcResponse {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}
