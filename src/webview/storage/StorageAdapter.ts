// Shared contract for wherever views/folders actually live. A folder or
// view's identity is its "/"-joined relative path (e.g.
// "samples/Order Fulfilment"), matching a real directory layout.

import type { ModelJSON, ModelElementRecord } from '../model.js';

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

/**
 * One folder or element inside a Model Tree layer (e.g. "Application"),
 * addressed the same "/"-joined-relative-path way as TreeEntry — `path`
 * always starts with the layer folder name, e.g. "Application/Payments" or
 * "Application/Payments/elem-x". Folder create/rename/move/delete reuse
 * StorageAdapter's existing createFolder/rename/deleteFolder directly,
 * since both Views and the Model Tree now share one path-addressed space.
 */
export type ModelTreeNode =
  | { type: 'folder'; path: string; name: string; parentPath: string }
  | { type: 'element'; path: string; name: string; parentPath: string; record: ModelElementRecord };

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

  // ---------- Model Tree (shared elements, see model.ts) ----------
  /** Every folder and element saved under any of the 7 layer roots, across all views — the Model Tree sidebar's data source. */
  listModelTree(): Promise<ModelTreeNode[]>;
  /** Creates or overwrites the shared record for one element (by id) — updates it in place if it's been organized into a subfolder, otherwise creates it fresh at the layer root. */
  writeModelElement(record: ModelElementRecord): Promise<void>;
}
