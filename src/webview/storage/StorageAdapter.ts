// Shared contract for wherever views/folders actually live. A folder or
// view's identity is its "/"-joined relative path (e.g.
// "samples/Order Fulfilment"), matching a real directory layout.

import type { ModelJSON } from '../model.js';

export interface ViewData {
  model: ModelJSON;
  view: { zoom: number; pan: { x: number; y: number } };
}

export interface TreeEntry {
  type: 'folder' | 'view';
  path: string;
  name: string;
  parentPath: string | null;
  updatedAt?: number;
}

export interface Settings {
  workDir?: string;
  externalFileUri?: string | null;
  [key: string]: unknown;
}

export interface StorageAdapter {
  getSettings(): Promise<Settings>;
  updateSettings(patch: Partial<Settings>): Promise<Settings>;
  listTree(): Promise<TreeEntry[]>;
  readView(path: string): Promise<ViewData>;
  writeView(path: string, data: ViewData): Promise<{ path: string; updatedAt: number }>;
  writeExternalView?(data: ViewData): Promise<{ ok: boolean }>;
  createFolder(path: string): Promise<void>;
  deleteFolder(path: string): Promise<void>;
  deleteView(path: string): Promise<void>;
  /** Renames or moves a view or folder (destination parent dirs created as needed). */
  rename(fromPath: string, toPath: string): Promise<void>;
}
