import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], build: { rollupOptions: { input: resolve(__dirname, 'src/main/index.ts') } } },
  // Sandboxed Electron preloads must be CommonJS. An ESM preload silently fails
  // in the packaged renderer, leaving the context bridge unavailable.
  preload: { plugins: [externalizeDepsPlugin()], build: { rollupOptions: { input: resolve(__dirname, 'src/preload/index.ts'), output: { format: 'cjs', entryFileNames: 'index.cjs' } } } },
  // Keep every Electron artifact under the root out/ directory so electron-builder
  // includes main, preload and renderer in the same app.asar.
  renderer: { root: resolve(__dirname, '../../ui'), envDir: resolve(__dirname, '../..'), plugins: [react()], build: { outDir: resolve(__dirname, '../../out/renderer'), emptyOutDir: true, rollupOptions: { input: resolve(__dirname, '../../ui/index.html') } } },
});
