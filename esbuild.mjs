// Bundles the extension host (Node/CJS) and the webview UI (browser/IIFE)
// separately with esbuild, then copies the CSS and palette icon assets the
// webview needs. No type-checking here — run `npm run typecheck` for that.

import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const watch = process.argv.includes('--watch');

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });

const extensionConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  sourcemap: true,
  logLevel: 'info',
};

const webviewConfig = {
  entryPoints: ['src/webview/main.ts'],
  bundle: true,
  outfile: 'dist/webview.js',
  platform: 'browser',
  format: 'esm', // main.ts uses top-level await
  target: 'es2022',
  sourcemap: true,
  logLevel: 'info',
};

const paletteViewConfig = {
  entryPoints: ['src/webview/paletteMain.ts'],
  bundle: true,
  outfile: 'dist/palette.js',
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  sourcemap: true,
  logLevel: 'info',
};

const inspectorViewConfig = {
  entryPoints: ['src/webview/inspectorMain.ts'],
  bundle: true,
  outfile: 'dist/inspector.js',
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  sourcemap: true,
  logLevel: 'info',
};

function copyAssets() {
  cpSync('src/webview/style.css', 'dist/webview.css');
  cpSync('src/webview/assets', 'dist/assets', { recursive: true });
}

if (watch) {
  const [extCtx, webCtx, paletteCtx, inspectorCtx] = await Promise.all([
    esbuild.context(extensionConfig),
    esbuild.context(webviewConfig),
    esbuild.context(paletteViewConfig),
    esbuild.context(inspectorViewConfig),
  ]);
  copyAssets();
  await Promise.all([extCtx.watch(), webCtx.watch(), paletteCtx.watch(), inspectorCtx.watch()]);
  console.log('esbuild watching for changes...');
} else {
  await Promise.all([
    esbuild.build(extensionConfig),
    esbuild.build(webviewConfig),
    esbuild.build(paletteViewConfig),
    esbuild.build(inspectorViewConfig),
  ]);
  copyAssets();
  console.log('Build complete.');
}
