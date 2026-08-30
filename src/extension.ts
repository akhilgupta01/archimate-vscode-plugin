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
} from "./fsBackend.js";
import type { RpcRequest, RpcResponse, RpcMethod } from "./protocol.js";
import type { Settings } from "./webview/storage/StorageAdapter.js";

const DEFAULT_WORK_DIR = path.join(os.homedir(), ".archi", "work");

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
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
      this.panel.webview.onDidReceiveMessage((msg: RpcRequest) =>
        this.handleMessage(msg),
      ),
      this.panel.onDidDispose(() => this.dispose()),
    );
  }

  private dispose(): void {
    DesignerPanel.current = undefined;
    for (const d of this.disposables) d.dispose();
  }

  private getWorkDir(): string {
    const configured = vscode.workspace
      .getConfiguration("archimate")
      .get<string>("workDir");
    return configured && configured.trim()
      ? path.resolve(configured.replace(/^~/, os.homedir()))
      : DEFAULT_WORK_DIR;
  }

  private async handleMessage(msg: RpcRequest): Promise<void> {
    const { id, method, params } = msg;
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
      case "listTree":
        return { root: workDir, entries: await walkTree(workDir) };
      case "readView":
        return readView(workDir, params.path as string);
      case "writeView":
        return writeView(workDir, params.path as string, params.data as any);
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
      default:
        throw new Error(`Unknown method: ${method satisfies never}`);
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
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
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

function getNonce(): string {
  let text = "";
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++)
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}
