// Palette icons: small bitmap crops sliced out of assets/icons.png (a
// reference ArchiMate tool's palette, supplied by the project owner) rather
// than hand-drawn glyphs, so the palette matches that tool's iconography
// exactly. See assets/ for the source sprite; each crop is named after the
// ArchiMate type it represents.
//
// Asset URLs differ by host: inside the VS Code webview they must go through
// `webview.asWebviewUri()` (a vscode-webview:// URL the extension injects as
// `window.__ARCHI_ASSET_BASE__` before this bundle loads); the standalone
// dev-preview harness just serves the folder directly over http, so a plain
// relative path works there too.

declare global {
  interface Window { __ARCHI_ASSET_BASE__?: string; }
}

function assetBase(): string {
  return window.__ARCHI_ASSET_BASE__ || './assets';
}

export function iconUrl(type: string): string {
  return `${assetBase()}/palette/${type}.png`;
}

// Same crops as iconUrl(), but with the layer-tinted fill stripped to
// transparent (only the gray line-art remains) — used for the on-canvas
// badge, which sits on top of the element's own (possibly overridden) fill
// colour rather than the palette's neutral list background, so a baked-in
// fill would clash instead of blending in.
export function badgeUrl(type: string): string {
  return `${assetBase()}/badges/${type}.png`;
}

function iconImg(type: string): HTMLImageElement {
  const img = document.createElement('img');
  img.src = iconUrl(type);
  img.alt = type;
  img.draggable = false;
  img.className = 'am-icon-img';
  return img;
}

export function elementIcon(type: string): HTMLImageElement { return iconImg(type); }
export function relationshipIcon(type: string): HTMLImageElement { return iconImg(type); }
