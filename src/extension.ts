import * as vscode from "vscode";
import * as path from "node:path";
import * as os from "node:os";
import {
  ensureDir,
  walkTree,
  readView,
  writeView,
  deleteView,
  createFolder,
  deleteFolderKeepingChildren,
  renamePath,
  listModelTree,
  writeModelElement,
} from "./fsBackend.js";
import type { RpcRequest, RpcResponse, RpcMethod } from "./protocol.js";
import type { Settings } from "./webview/storage/StorageAdapter.js";
import { LAYERS, modelElementFolder } from "./webview/model.js";
import type { ModelElementRecord } from "./webview/model.js";

// Handles every storage RPC method that doesn't need anything
// panel-specific (an open external file, in DesignerPanel's case) — shared
// by DesignerPanel (the full StorageAdapter surface) and
// ModelTreeViewProvider (only ever calls the Model-Tree-relevant subset,
// but there's no harm exposing the rest) so both webviews' StorageAdapter
// instances talk to the exact same on-disk logic.
async function dispatchStorageRpc(
  method: RpcMethod,
  params: Record<string, unknown>,
  workDir: string,
): Promise<unknown> {
  switch (method) {
    case "listTree":
      return { root: workDir, entries: await walkTree(workDir) };
    case "readView":
      return readView(workDir, params.path as string);
    case "writeView":
      return writeView(workDir, params.path as string, params.data as any);
    case "deleteView":
      await deleteView(workDir, params.path as string);
      return { ok: true };
    case "createFolder":
      await createFolder(workDir, params.path as string);
      return { ok: true };
    case "deleteFolder":
      await deleteFolderKeepingChildren(workDir, params.path as string);
      return { ok: true };
    case "rename":
      await renamePath(workDir, params.from as string, params.to as string);
      return { ok: true };
    case "listModelTree":
      return { nodes: await listModelTree(workDir) };
    case "writeModelElement": {
      const record = params.record as ModelElementRecord;
      const folder = LAYERS[modelElementFolder(record.type)].label;
      await writeModelElement(workDir, folder, record);
      return { ok: true };
    }
    default:
      throw new Error(`Unsupported here: ${method}`);
  }
}

const DEFAULT_WORK_DIR = path.join(os.homedir(), ".archi", "work");

// Views and Model Tree element records both live under this one directory.
// Priority: an explicit archimate.workDir setting always wins (the user
// said exactly where they want it); otherwise, if a folder is open in this
// VS Code window, use that — so views/elements land right in the user's
// own project and show up in the Explorer, matching how Archi's own Model
// Tree lives alongside the rest of the project rather than off in some
// hidden home-directory cache. Only falls back to ~/.archi/work when
// neither applies (e.g. no folder open at all).
function resolveWorkDir(): string {
  const configured = vscode.workspace
    .getConfiguration("archimate")
    .get<string>("workDir");
  if (configured && configured.trim()) {
    return path.resolve(configured.replace(/^~/, os.homedir()));
  }
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder) return folder.uri.fsPath;
  return DEFAULT_WORK_DIR;
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "archimate.paletteView",
      new PaletteViewProvider(context),
    ),
    vscode.window.registerWebviewViewProvider(
      "archimate.inspectorView",
      new InspectorViewProvider(context),
    ),
    vscode.window.registerWebviewViewProvider(
      "archimate.modelTreeView",
      new ModelTreeViewProvider(context),
    ),
    vscode.commands.registerCommand("archimate.openDesigner", () => {
      DesignerPanel.createOrShow(context);
    }),
    vscode.commands.registerCommand(
      "archimate.openFile",
      async (resource?: vscode.Uri) => {
        const fileUri =
          resource ?? vscode.window.activeTextEditor?.document.uri;
        if (!fileUri) {
          vscode.window.showErrorMessage(
            "Select a .json diagram file first, then choose “Open in Archimate Editor”.",
          );
          return;
        }

        try {
          const raw = await vscode.workspace.fs.readFile(fileUri);
          const text = Buffer.from(raw).toString("utf8");
          const json = JSON.parse(text);
          DesignerPanel.createOrShow(context, fileUri, json);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(
            `Could not open ${fileUri.fsPath}: ${message}`,
          );
        }
      },
    ),
    vscode.commands.registerCommand("archimate.openSettings", async () => {
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "@ext:local-dev.archimate-diagrams",
      );
    }),
  );
}

export function deactivate(): void {
  /* nothing to clean up */
}

class DesignerPanel {
  private static current: DesignerPanel | undefined;
  // WebviewViews (unlike WebviewPanels, which support retainContextWhenHidden)
  // are, per VS Code's own docs, expected to be disposed and recreated every
  // time they're hidden and shown again — e.g. switching to the Problems tab
  // and back to Inspector. That wipes their in-page JS state, so the source
  // of truth for "what's armed" / "what's selected" is kept here instead,
  // and re-pushed to each view as soon as it (re)resolves — see
  // PaletteViewProvider/InspectorViewProvider's resolveWebviewView.
  private static lastArmed: { kind: string | null; archiType: string | null } =
    { kind: null, archiType: null };
  private static lastSelection: unknown = null;
  private readonly panel: vscode.WebviewPanel;
  private readonly context: vscode.ExtensionContext;
  private readonly disposables: vscode.Disposable[] = [];
  private initialFileUri?: vscode.Uri;
  private initialJson: unknown;

  static createOrShow(
    context: vscode.ExtensionContext,
    initialFileUri?: vscode.Uri,
    initialJson?: unknown,
  ): void {
    if (DesignerPanel.current) {
      if (initialFileUri || initialJson !== undefined) {
        DesignerPanel.current.initialFileUri = initialFileUri;
        DesignerPanel.current.initialJson = initialJson ?? null;
        DesignerPanel.current.panel.webview.html =
          DesignerPanel.current.getHtml();
      }
      DesignerPanel.current.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "archimateDesigner",
      initialFileUri
        ? `ArchiMate Designer — ${path.basename(initialFileUri.fsPath)}`
        : "ArchiMate Designer",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")],
      },
    );
    DesignerPanel.current = new DesignerPanel(
      panel,
      context,
      initialFileUri,
      initialJson,
    );
  }

  /** Relays a tool-arm request from the Palette sidebar view to the designer canvas. */
  static postToolArm(kind: string, archiType: string): void {
    if (!DesignerPanel.current) {
      vscode.window.showInformationMessage(
        'Open the ArchiMate Designer first (run "ArchiMate: Open Designer"), then pick a tool from the palette.',
      );
      return;
    }
    DesignerPanel.current.panel.webview.postMessage({
      type: "archiToolArm",
      kind,
      archiType,
    });
  }

  /** Relays an edit or reroute request from the Inspector sidebar view to the designer canvas. */
  static postInspectorMessage(msg: unknown): void {
    DesignerPanel.current?.panel.webview.postMessage(msg);
  }

  /** Relays "place this existing Model Tree element" from the Model Tree sidebar view to the designer canvas — arms it the same way a Palette element type does, but carrying a specific element's id/name/documentation to reuse rather than a fresh one to create. */
  static postModelElementArm(record: ModelElementRecord): void {
    if (!DesignerPanel.current) {
      vscode.window.showInformationMessage(
        'Open the ArchiMate Designer first (run "ArchiMate: Open Designer"), then drag a component from the Model Tree.',
      );
      return;
    }
    DesignerPanel.current.panel.webview.postMessage({
      type: "archiModelElementArm",
      record,
    });
  }

  static getLastArmed(): { kind: string | null; archiType: string | null } {
    return DesignerPanel.lastArmed;
  }

  static getLastSelection(): unknown {
    return DesignerPanel.lastSelection;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    initialFileUri?: vscode.Uri,
    initialJson?: unknown,
  ) {
    this.panel = panel;
    this.context = context;
    this.initialFileUri = initialFileUri;
    this.initialJson = initialJson ?? null;
    this.panel.webview.html = this.getHtml();
    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((msg) => this.handleMessage(msg)),
      this.panel.onDidDispose(() => this.dispose()),
    );
  }

  private dispose(): void {
    DesignerPanel.current = undefined;
    // Closing the designer means there's no canvas left to have armed a
    // tool or selected anything — drop the cached state so a freshly
    // (re)opened designer doesn't hand the sidebar views stale leftovers.
    DesignerPanel.lastArmed = { kind: null, archiType: null };
    DesignerPanel.lastSelection = null;
    PaletteViewProvider.current?.postArmedChanged(null, null);
    InspectorViewProvider.current?.postSelectionChanged(null);
    for (const d of this.disposables) d.dispose();
  }

  private getWorkDir(): string {
    return resolveWorkDir();
  }

  private async handleMessage(msg: any): Promise<void> {
    if (msg && msg.type === "archiToolArmedChanged") {
      DesignerPanel.lastArmed = {
        kind: msg.kind ?? null,
        archiType: msg.archiType ?? null,
      };
      PaletteViewProvider.current?.postArmedChanged(
        DesignerPanel.lastArmed.kind,
        DesignerPanel.lastArmed.archiType,
      );
      return;
    }
    if (msg && msg.type === "archiSelectionChanged") {
      DesignerPanel.lastSelection = msg.selection ?? null;
      InspectorViewProvider.current?.postSelectionChanged(
        DesignerPanel.lastSelection,
      );
      return;
    }
    const { id, method, params } = msg as RpcRequest;
    try {
      const result = await this.dispatch(method, params || {});
      this.panel.webview.postMessage({
        id,
        ok: true,
        result,
      } satisfies RpcResponse);
    } catch (err) {
      this.panel.webview.postMessage({
        id,
        ok: false,
        error: (err as Error).message,
      } satisfies RpcResponse);
    }
  }

  private async dispatch(
    method: RpcMethod,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const workDir = this.getWorkDir();
    await ensureDir(workDir);
    switch (method) {
      case "getSettings":
        return {
          workDir,
          externalFileUri: this.initialFileUri?.toString() || null,
        } satisfies Settings;
      case "updateSettings": {
        const patch = params as Partial<Settings>;
        if (patch.workDir) {
          const next = path.resolve(
            String(patch.workDir).replace(/^~/, os.homedir()),
          );
          await ensureDir(next);
          await vscode.workspace
            .getConfiguration("archimate")
            .update("workDir", next, vscode.ConfigurationTarget.Global);
        }
        return { workDir: this.getWorkDir() } satisfies Settings;
      }
      case "writeExternalView": {
        if (!this.initialFileUri) throw new Error("No external file is open");
        const data = params.data as any;
        const json = JSON.stringify(
          { model: data.model, view: data.view },
          null,
          2,
        );
        await vscode.workspace.fs.writeFile(
          this.initialFileUri,
          Buffer.from(json, "utf8"),
        );
        return { ok: true };
      }
      default: {
        const result = await dispatchStorageRpc(method, params, workDir);
        // A change here could be organizing a component into a subfolder
        // as easily as creating/renaming one, so refresh the Model Tree
        // sidebar (if it's open) after any of these, not just writes.
        if (method === "writeModelElement" || method === "createFolder" || method === "rename" || method === "deleteFolder") {
          void ModelTreeViewProvider.current?.postTree();
        }
        return result;
      }
    }
  }

  private getHtml(): string {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview.js"),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview.css"),
    );
    const codiconUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "codicon.css"),
    );
    const assetsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "assets"),
    );
    const nonce = getNonce();
    const initialJson = JSON.stringify(this.initialJson ?? null);
    const initialPath = JSON.stringify(
      this.initialFileUri ? this.initialFileUri.fsPath : null,
    );
    const externalFileUri = JSON.stringify(
      this.initialFileUri ? this.initialFileUri.toString() : null,
    );
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${codiconUri}">
<link rel="stylesheet" href="${styleUri}">
<style>html,body{margin:0;height:100%;background:#fafafa;} #app{height:100vh;}</style>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}">window.__ARCHI_ASSET_BASE__ = ${JSON.stringify(assetsUri.toString())}; window.__ARCHI_INITIAL_JSON__ = ${initialJson}; window.__ARCHI_INITIAL_PATH__ = ${initialPath}; window.__ARCHI_EXTERNAL_FILE_URI__ = ${externalFileUri};</script>
<script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

// The Palette lives in its own Activity Bar sidebar (see package.json's
// viewsContainers/views) rather than sharing space with the canvas inside
// the DesignerPanel webview. It's a separate WebviewView — an isolated
// context that can't drag-and-drop onto the DesignerPanel's canvas — so it
// just posts "arm this tool" notifications, relayed through DesignerPanel
// (see postToolArm / handleMessage's archiToolArmedChanged branch above).
class PaletteViewProvider implements vscode.WebviewViewProvider {
  static current: PaletteViewProvider | undefined;
  private view: vscode.WebviewView | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    PaletteViewProvider.current = this;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "dist"),
      ],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((msg) => {
      if (msg && msg.type === "archiToolArm") {
        DesignerPanel.postToolArm(msg.kind, msg.archiType);
      }
    });
    // A fresh HTML load always starts unarmed — hydrate it with whatever's
    // actually armed right now (see DesignerPanel.lastArmed) so re-showing
    // this view after it was hidden (which discards its JS/DOM state, same
    // as any WebviewView) doesn't fall out of sync with the canvas.
    const armed = DesignerPanel.getLastArmed();
    this.postArmedChanged(armed.kind, armed.archiType);
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        const current = DesignerPanel.getLastArmed();
        this.postArmedChanged(current.kind, current.archiType);
      }
    });
    webviewView.onDidDispose(() => {
      if (PaletteViewProvider.current === this) {
        PaletteViewProvider.current = undefined;
      }
      this.view = undefined;
    });
  }

  /** Relays the designer canvas's armed/cleared tool state back so this view's highlight stays in sync. */
  postArmedChanged(kind: string | null, archiType: string | null): void {
    this.view?.webview.postMessage({
      type: "archiToolArmedChanged",
      kind,
      archiType,
    });
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "palette.js"),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview.css"),
    );
    const codiconUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "codicon.css"),
    );
    const assetsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "assets"),
    );
    const nonce = getNonce();
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${codiconUri}">
<link rel="stylesheet" href="${styleUri}">
<style>html,body{margin:0;height:100%;background:var(--vscode-panel-background,#fff);color:var(--vscode-foreground,#222);} #app{height:100vh;}</style>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}">window.__ARCHI_ASSET_BASE__ = ${JSON.stringify(assetsUri.toString())};</script>
<script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

// The Inspector lives in its own sidebar view too (stacked under the
// Palette in the same Activity Bar container), instead of the dock next to
// the canvas — same rationale and relay pattern as PaletteViewProvider
// above: it's an isolated webview, so the extension host relays the
// designer's current selection to it (archiSelectionChanged) and relays its
// edits back (archiInspectorEdit / archiInspectorReroute / archiInspectorReset,
// forwarded verbatim via DesignerPanel.postInspectorMessage).
class InspectorViewProvider implements vscode.WebviewViewProvider {
  static current: InspectorViewProvider | undefined;
  private view: vscode.WebviewView | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    InspectorViewProvider.current = this;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "dist"),
      ],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((msg) => {
      if (
        msg &&
        (msg.type === "archiInspectorEdit" ||
          msg.type === "archiInspectorReroute" ||
          msg.type === "archiInspectorReset")
      ) {
        DesignerPanel.postInspectorMessage(msg);
      }
    });
    // A fresh HTML load always starts with no selection shown — hydrate it
    // with whatever's actually selected right now (see
    // DesignerPanel.lastSelection) so re-showing this view after it was
    // hidden (which discards its JS/DOM state, same as any WebviewView —
    // this is the "properties disappear when I switch back from Problems"
    // symptom) doesn't fall out of sync with the canvas.
    this.postSelectionChanged(DesignerPanel.getLastSelection());
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.postSelectionChanged(DesignerPanel.getLastSelection());
      }
    });
    webviewView.onDidDispose(() => {
      if (InspectorViewProvider.current === this) {
        InspectorViewProvider.current = undefined;
      }
      this.view = undefined;
    });
  }

  /** Relays the designer canvas's current selection so this view can show/edit its properties. */
  postSelectionChanged(selection: unknown): void {
    this.view?.webview.postMessage({
      type: "archiSelectionChanged",
      selection,
    });
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "inspector.js"),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview.css"),
    );
    const codiconUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "codicon.css"),
    );
    const nonce = getNonce();
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${codiconUri}">
<link rel="stylesheet" href="${styleUri}">
<style>html,body{margin:0;height:100%;background:var(--vscode-panel-background,#fff);color:var(--vscode-foreground,#222);} #app{height:100vh;}</style>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

// The Model Tree lives in its own Activity Bar container — a separate icon
// in the primary sidebar, not stacked under the Palette — since it browses
// a different thing (every saved element, across every view) than the
// Palette's per-view tool list. Every element ever placed on any view is
// also saved as a standalone record (writeModelElement,
// above) independent of any single view, and this lists them so one can be
// dragged into other views to reuse it. Unlike Palette/Inspector, this view
// doesn't mirror live canvas state (there's no "currently armed tool" of
// its own to echo back) — it just reads the saved records straight from
// disk and re-reads them whenever a write happens anywhere.
class ModelTreeViewProvider implements vscode.WebviewViewProvider {
  static current: ModelTreeViewProvider | undefined;
  private view: vscode.WebviewView | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    ModelTreeViewProvider.current = this;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "dist"),
      ],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((msg) => this.handleMessage(msg));
    void this.postTree();
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) void this.postTree();
    });
    webviewView.onDidDispose(() => {
      if (ModelTreeViewProvider.current === this) {
        ModelTreeViewProvider.current = undefined;
      }
      this.view = undefined;
    });
  }

  // Two message shapes come through here: the special "place this on the
  // canvas" arm request (relayed to DesignerPanel, same as the Palette's
  // archiToolArm), and generic StorageAdapter RPC requests — this view has
  // its own VSCodeAdapter (see modelTreeMain.ts) so it can create/rename/
  // move/delete folders and elements independent of whether a Designer
  // canvas is even open, not just browse them.
  private async handleMessage(msg: any): Promise<void> {
    if (msg && msg.type === "archiModelElementArm") {
      DesignerPanel.postModelElementArm(msg.record as ModelElementRecord);
      return;
    }
    const { id, method, params } = msg as RpcRequest;
    if (!method) return;
    try {
      const workDir = resolveWorkDir();
      await ensureDir(workDir);
      const result = await dispatchStorageRpc(method, params || {}, workDir);
      if (method === "writeModelElement" || method === "createFolder" || method === "rename" || method === "deleteFolder") {
        void this.postTree();
      }
      this.view?.webview.postMessage({ id, ok: true, result } satisfies RpcResponse);
    } catch (err) {
      this.view?.webview.postMessage({ id, ok: false, error: (err as Error).message } satisfies RpcResponse);
    }
  }

  /** Re-reads the Model Tree from disk and pushes it to this view (if it's currently resolved — a harmless no-op otherwise). */
  async postTree(): Promise<void> {
    if (!this.view) return;
    const workDir = resolveWorkDir();
    await ensureDir(workDir);
    const nodes = await listModelTree(workDir);
    this.view.webview.postMessage({ type: "archiModelElementsChanged", nodes });
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "modelTree.js"),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview.css"),
    );
    const codiconUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "codicon.css"),
    );
    const assetsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "assets"),
    );
    const nonce = getNonce();
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${codiconUri}">
<link rel="stylesheet" href="${styleUri}">
<style>html,body{margin:0;height:100%;background:var(--vscode-sideBar-background,#fff);color:var(--vscode-foreground,#222);} #app{height:100vh;}</style>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}">window.__ARCHI_ASSET_BASE__ = ${JSON.stringify(assetsUri.toString())};</script>
<script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = "";
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++)
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}
