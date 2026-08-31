// Webview entry point. Bundled by esbuild into dist/webview.js and loaded
// by extension.ts inside a VS Code WebviewPanel — or, for local UI
// development without launching VS Code, by preview/index.html directly.

import { ArchimateDesigner } from "./designer.js";
import { VSCodeAdapter, VsCodeApi } from "./storage/VSCodeAdapter.js";
import { LocalStorageAdapter } from "./storage/LocalStorageAdapter.js";
import type {
  StorageAdapter,
  TreeEntry,
  ViewData,
} from "./storage/StorageAdapter.js";
import type { ElementType, RelationshipType } from "./model.js";

declare function acquireVsCodeApi(): VsCodeApi;

// acquireVsCodeApi() may only be called once per webview session, and both
// the storage adapter (RPC to the extension host) and the designer (palette
// arm/disarm relay, see ArchimateDesignerOptions.hostApi) need it, so it's
// acquired exactly once here and shared.
const vscodeApi: VsCodeApi | null =
  typeof (window as any).acquireVsCodeApi === "function"
    ? acquireVsCodeApi()
    : null;

const storage: StorageAdapter = vscodeApi
  ? new VSCodeAdapter(vscodeApi)
  : new LocalStorageAdapter({ storageKey: "archimate-preview" });

const app = document.getElementById("app");
if (!app) throw new Error("#app root not found");

const designer = new ArchimateDesigner(app, {
  storage,
  hostApi: vscodeApi,
  onSave: (json: ViewData & { viewPath: string }) =>
    console.log("Saved view:", json.viewPath),
});
(window as any).designer = designer;

const initialJson = (window as any).__ARCHI_INITIAL_JSON__ as
  | ViewData
  | undefined;
const initialPath = (window as any).__ARCHI_INITIAL_PATH__ as string | null;
const externalFileUri = (window as any).__ARCHI_EXTERNAL_FILE_URI__ as
  | string
  | null;
if (initialJson) {
  designer.load(initialJson);
  designer.currentViewPath = initialPath;
  designer.externalFileUri = externalFileUri;
} else {
  await bootstrap();
}

async function bootstrap(): Promise<void> {
  const tree: TreeEntry[] = await designer.storage.listTree();
  const views = tree.filter((e) => e.type === "view");
  if (views.length) {
    const latest = [...views].sort(
      (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
    )[0];
    await designer.loadView(latest.path);
  } else {
    seedSample(designer);
    await designer.save();
  }
}

function seedSample(d: ArchimateDesigner): void {
  const add = (type: ElementType, x: number, y: number, name: string) =>
    d.addElement(type, x, y, { name });
  const actor = add("BusinessActor", 40, 40, "Customer");
  const process = add("BusinessProcess", 280, 40, "Handle Order");
  const bservice = add("BusinessService", 280, 180, "Ordering Service");
  const appComp = add("ApplicationComponent", 560, 40, "Order Management App");
  const appService = add("ApplicationService", 560, 180, "Order API");
  const dataObj = add("DataObject", 560, 300, "Order");
  const node = add("Node", 820, 40, "App Server");
  const tech = add("TechnologyService", 820, 180, "Hosting Service");
  const goal = add("Goal", 40, 300, "Fast Order Fulfilment");

  const rel = (
    type: RelationshipType,
    sourceId: string,
    targetId: string,
    name = "",
  ) => d.addRelationship(type, sourceId, targetId, { name });
  rel("Triggering", actor.id, process.id);
  rel("Serving", bservice.id, process.id);
  rel("Realization", process.id, bservice.id);
  rel("Serving", appService.id, bservice.id, "supports");
  rel("Assignment", appComp.id, appService.id);
  rel("Access", appComp.id, dataObj.id, "CRUD");
  rel("Serving", tech.id, appComp.id, "hosts");
  rel("Assignment", node.id, tech.id);
  rel("Influence", goal.id, process.id, "+");
  d.renderer.rerouteAll();
  d.resetView();
}
