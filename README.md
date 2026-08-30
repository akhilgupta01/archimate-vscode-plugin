# archimate-diagrams

A VS Code extension for building interactive ArchiMate diagrams — SVG rendering across all ArchiMate layers, automatic orthogonal (Manhattan-style) connector routing with obstacle avoidance, drag-to-reposition with live re-routing, resize with alignment guides, multi-select, zoom/pan, and a palette-first designer UI — written in TypeScript.

The designer runs in a VS Code Webview; the extension host owns the filesystem and persists your diagrams as real files under `~/.archi/work` (configurable). There's also a standalone dev-preview harness for iterating on the UI without launching VS Code.

## Development

```bash
cd archimate-diagrams
npm install
npm run watch          # esbuild --watch, rebuilds dist/ on save
```

Then in VS Code: open this folder, press **F5** (Run → Start Debugging) to launch an Extension Development Host with the extension loaded, and run **ArchiMate: Open Designer** from the Command Palette in that window.

Other scripts:

```bash
npm run compile         # one-shot build (dist/extension.js, dist/webview.js, + CSS/assets)
npm run typecheck       # tsc --noEmit across the whole project
npm run package          # vsce package -> a .vsix you can install directly
```

### UI-only preview (no VS Code needed)

```bash
npm run compile
npm run dev:preview      # static server at http://localhost:8080/preview/
```

`preview/index.html` loads the exact same `dist/webview.js` bundle the real extension uses, but `main.ts` detects there's no `acquireVsCodeApi()` and falls back to `LocalStorageAdapter`, so views persist to the browser's `localStorage` instead of real files. Good for fast iteration on layout/interaction; not where your real diagrams should live.

## Where your views live

The extension host (`src/extension.ts`, using `src/fsBackend.ts`) persists views/folders as real files on disk instead of some opaque store, so they survive across machines, show up in `git`, and are inspectable/editable outside the tool if you ever need to.

On first use it creates:

- **`~/.archi/work/`** (or wherever the `archimate.workDir` setting points) — your views and folders, as an actual directory tree. A folder you create in the app's Views panel is a real directory; a view you save is a `<name>.json` file in it (containing the same `{model, view}` shape `exportJSON()` produces). Renaming, moving (drag-and-drop in the tree), and deleting all operate on real files — `mv`/`ls`/`git` all see exactly what the app shows.

To change where views are stored, open VS Code Settings and set **ArchiMate Diagrams: Work Dir** (`archimate.workDir`), or edit it directly in `settings.json`:

```json
{ "archimate.workDir": "/Users/you/projects/architecture" }
```

Existing files aren't moved automatically — copy them over yourself if you want them in the new location. Leaving it empty uses the `~/.archi/work` default.

## Using the designer

- **Views panel (left, default-visible)** — a folder tree of everything you've saved. Click a view to load it; double-click a folder or view to rename it inline; drag one onto a folder (or onto empty space, for the root) to move it — real files move on disk as you do this; hover and click "×" to delete (deleting a folder keeps its contents, moving them up a level); "+ Folder"/"+ View" create new ones. There is no menu bar — this tree *is* the primary way to manage diagrams.
- **Canvas (center)** — drag a palette item onto the canvas to create an element; drag an element to reposition it — connectors re-route automatically and live as you drag, and dragging snaps into alignment with other elements' edges/centers (a pink guide line appears, PowerPoint-style) when they're close on the same X or Y axis. Select an element to reveal 8 resize handles; drag one to resize — it snaps to another element's edge/center first, falling back to the grid. Click a relationship icon in the palette, then click a source element and a target element, to draw that connection. Select a connector to reveal a small handle at each end — drag a handle to choose exactly where it leaves the source or enters the target; it's constrained to that element's edge and snaps to the grid. **Multi-select**: drag from empty canvas to rubber-band select every element inside the box (PowerPoint-style — Shift adds to the existing selection); Shift-click toggles one element *or connector* at a time, in or out of the selection; Ctrl/Cmd+A or right-click → Select All selects everything; dragging any selected element moves the whole selection together. Right-click also offers Deselect All and Delete Selected. Mouse wheel zooms (centered on the cursor); drag empty canvas to marquee-select, or hold Space (or the middle mouse button) and drag to pan. Delete/Backspace removes the current selection.
- **Palette (right, default-visible, collapsible)** — every ArchiMate element type as an icon (a miniature of its real on-canvas shape, colored by layer) grouped into collapsible sections (Relationships, Strategy, Business, Application, Technology, Motivation, Implementation & Migration, Other), each with a hover tooltip naming it, plus a filter box. Click the **▸** in its header to collapse it to a slim edge tab (click the tab to bring it back) when you want the canvas full-width.
- **Inspector** — docked under the palette; edit the name/documentation of the selected element, or the label of the selected relationship, and force a relationship to re-route from scratch.
- **Toolbar** — zoom controls, delete, Import/Export (`.json` file), and Save (writes the current canvas to the active view — or creates a new one, auto-named).

## Architecture

```
src/
  extension.ts        # extension host entry point: registers the command, owns the WebviewPanel + fs access
  fsBackend.ts         # pure Node fs logic (walk/read/write/rename/delete) rooted at workDir — no `vscode` import
  protocol.ts          # RPC message shapes shared by the webview and the host
  webview/
    main.ts            # webview entry point, bundled to dist/webview.js
    designer.ts         # ArchimateDesigner: builds the DOM UI, wires all interactions
    model.ts / router.ts / renderer.ts / snap.ts / icons.ts / markers.ts / svgUtil.ts
    storage/
      StorageAdapter.ts  # shared interface (path-addressed: "samples/Order Fulfilment")
      VSCodeAdapter.ts   # talks to the extension host via postMessage — what the real extension uses
      LocalStorageAdapter.ts  # localStorage-backed fallback, used by the standalone preview harness
    assets/palette/*.png  # per-type icon crops (see "Palette icon assets" below)
```

The webview has no filesystem access (browser sandbox), so `designer.storage` is always an adapter: `VSCodeAdapter` proxies every call (`listTree`, `readView`, `writeView`, `createFolder`, `rename`, `deleteFolder`, `deleteView`, `getSettings`/`updateSettings`) over `postMessage` to `extension.ts`, which does the actual `fs.readFile`/`writeFile`/`rename` via `fsBackend.ts` and replies with the same request id. `LocalStorageAdapter` implements the identical interface for the no-VS-Code preview harness. Swap in your own adapter for a different backend (a database, a remote API, …) by implementing the eight `StorageAdapter` methods.

Everything under `src/webview/` is plain browser TypeScript (no VS Code API imports) and is bundled by esbuild into a single self-contained `dist/webview.js` — see `esbuild.mjs`.

## Routing algorithm

Each connector is routed over a sparse visibility grid built from the interesting x/y coordinates of every element's bounding box (expanded by a clearance margin), rather than a dense pixel grid — this keeps routing fast even with many elements. A* search over that grid finds the shortest orthogonal path, with a bend penalty (fewer turns) and a lane-usage penalty (previously-used segments cost more, so parallel connectors spread into adjacent corridors instead of overlapping). Labels are placed at the midpoint of a route's longest segment with a background plate for legibility.

Re-routing is incremental: dragging an element only recomputes the routes of edges touching it (`renderer.rerouteConnected(id)`); `renderer.rerouteAll()` recomputes everything, e.g. after bulk changes or on load. A relationship can be pinned to a manual route by setting `relationship.bendpoints`; clearing it (`bendpoints = null`) returns it to auto-routing.

A connector's endpoints can also be pinned individually, without giving up auto-routing for the rest of the path: `relationship.sourcePort` / `.targetPort` hold `{ side: 'n'|'s'|'e'|'w', t: 0..1 }` (`t` is the fraction along that edge), set by dragging the small handle that appears at each end of a selected connector. The drag is constrained to the element's boundary and snaps to the canvas grid (`GRID_SIZE` in `src/webview/designer.ts`, 10 by default); clearing both back to `null` (the inspector's "Auto-route again" button does this, along with `bendpoints`) lets the router choose the side again.

## Resizing and alignment guides

`src/webview/snap.ts` holds the snapping math, used by both element move and resize:

- **Move** (`computeMoveSnap`) compares the dragged element's left/center/right and top/middle/bottom against every other element's matching lines; whichever axis has the closest match within a screen-space threshold (`GUIDE_SNAP_PX` in `designer.ts`, converted to world units by dividing by the current zoom) snaps into exact alignment, and a guide line is drawn for it.
- **Resize** (`computeResizedBox` / `enforceMinSize` / `computeResizeSnap`) is driven by which of the 8 handles is being dragged — only the edge(s) that handle actually moves are snapped. Each one first tries to align with another element's edge/center line; if nothing is close enough, it falls back to the grid (`GRID_SIZE`). A minimum size (`MIN_W`/`MIN_H` in `snap.ts`) keeps elements from collapsing.

Guide lines are drawn in `renderer.guideLayer` (`showGuides()`/`clearGuides()`) and only exist while a drag is in progress.

## Supported ArchiMate types

All ArchiMate 3.2 element types across Motivation, Strategy, Business, Application, Technology, Physical, Implementation & Migration, plus `Grouping`/`Location`/`Junction`. All relationship types: Composition, Aggregation, Assignment, Realization, Serving, Access, Influence, Triggering, Flow, Specialization, Association — each rendered with the correct ArchiMate line style and arrowhead/diamond notation.

See `src/webview/model.ts` for the full catalogue and `src/webview/index.ts` for the public exports.

## Palette icon assets

`src/webview/assets/icons.png` is a palette screenshot supplied by the project owner (source tool unconfirmed); `src/webview/assets/palette/*.png` are per-type crops sliced out of it, one per ArchiMate element/relationship, referenced by `src/webview/icons.ts` (served through `webview.asWebviewUri` inside the extension, or a relative path in the preview harness). If you plan to publish this extension publicly, confirm you have the right to redistribute that sprite before shipping it — swap in your own icon set via `icons.ts` if not.
