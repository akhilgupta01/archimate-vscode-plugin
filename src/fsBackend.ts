// Filesystem operations backing the storage RPC, rooted at a workDir. Pure
// Node (no `vscode` import) so it's usable/testable independent of the
// extension host. Mirrors the StorageAdapter contract in
// src/webview/storage/StorageAdapter.ts, just server-side.

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { TreeEntry, ViewData } from './webview/storage/StorageAdapter.js';

export async function ensureDir(p: string): Promise<void> {
  await fs.mkdir(p, { recursive: true });
}

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

// Resolve a client-supplied relative path against workDir, refusing to
// leave it (blocks "../../etc" style traversal).
function safeResolve(workDir: string, relPath: string): string {
  const rel = String(relPath || '').replace(/^\/+/, '');
  const resolved = path.resolve(workDir, rel);
  const root = path.resolve(workDir) + path.sep;
  if (resolved !== path.resolve(workDir) && !resolved.startsWith(root)) {
    throw new Error('Path escapes workDir');
  }
  return resolved;
}

function viewFilePath(workDir: string, relPath: string): string {
  return `${safeResolve(workDir, relPath)}.json`;
}

export async function walkTree(workDir: string): Promise<TreeEntry[]> {
  const entries: TreeEntry[] = [];
  async function walk(dirAbs: string, parentRel: string | null): Promise<void> {
    const items = await fs.readdir(dirAbs, { withFileTypes: true });
    for (const item of items) {
      if (item.name.startsWith('.')) continue;
      const abs = path.join(dirAbs, item.name);
      if (item.isDirectory()) {
        const rel = parentRel ? `${parentRel}/${item.name}` : item.name;
        entries.push({ type: 'folder', path: rel, name: item.name, parentPath: parentRel || null });
        await walk(abs, rel);
      } else if (item.isFile() && item.name.endsWith('.json')) {
        const name = item.name.slice(0, -5);
        const rel = parentRel ? `${parentRel}/${name}` : name;
        const stat = await fs.stat(abs);
        entries.push({ type: 'view', path: rel, name, parentPath: parentRel || null, updatedAt: stat.mtimeMs });
      }
    }
  }
  await walk(workDir, null);
  return entries;
}

export async function readView(workDir: string, relPath: string): Promise<ViewData> {
  const p = viewFilePath(workDir, relPath);
  return JSON.parse(await fs.readFile(p, 'utf8'));
}

export async function writeView(workDir: string, relPath: string, data: ViewData): Promise<{ path: string; updatedAt: number }> {
  const p = viewFilePath(workDir, relPath);
  await ensureDir(path.dirname(p));
  await fs.writeFile(p, JSON.stringify(data, null, 2));
  const stat = await fs.stat(p);
  return { path: relPath, updatedAt: stat.mtimeMs };
}

export async function deleteView(workDir: string, relPath: string): Promise<void> {
  const p = viewFilePath(workDir, relPath);
  if (await exists(p)) await fs.unlink(p);
}

export async function createFolder(workDir: string, relPath: string): Promise<void> {
  await ensureDir(safeResolve(workDir, relPath));
}

// Delete a folder, moving its direct children up into its parent first
// (matches the app's "deleting a folder doesn't lose what's inside" rule).
export async function deleteFolderKeepingChildren(workDir: string, relPath: string): Promise<void> {
  const abs = safeResolve(workDir, relPath);
  const parentRel = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : null;
  const parentAbs = parentRel ? safeResolve(workDir, parentRel) : workDir;
  const items = await fs.readdir(abs, { withFileTypes: true });
  for (const item of items) {
    await fs.rename(path.join(abs, item.name), path.join(parentAbs, item.name));
  }
  await fs.rmdir(abs);
}

// Renames/moves either a view (a `<name>.json` file) or a folder (a plain
// directory) — tries the view-file interpretation first since that's the
// common case, then falls back to a directory rename.
export async function renamePath(workDir: string, fromRel: string, toRel: string): Promise<void> {
  const fromView = viewFilePath(workDir, fromRel);
  const toView = viewFilePath(workDir, toRel);
  if (await exists(fromView)) {
    if (await exists(toView)) throw new Error('Destination already exists');
    await ensureDir(path.dirname(toView));
    await fs.rename(fromView, toView);
    return;
  }
  const fromDir = safeResolve(workDir, fromRel);
  const toDir = safeResolve(workDir, toRel);
  if (await exists(toDir)) throw new Error('Destination already exists');
  await ensureDir(path.dirname(toDir));
  await fs.rename(fromDir, toDir);
}
