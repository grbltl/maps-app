/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: {
    // maplibre-gl ships its own Web Worker chunk (maplibre-gl-worker.mjs).
    // Vite's esbuild-based dep pre-bundler doesn't handle that well and can
    // reference a stale/missing path under node_modules/.vite/deps after a
    // version bump - excluding it serves the package's own ESM as-is instead.
    exclude: ['maplibre-gl']
  },
  test: {
    environment: 'jsdom'
  }
});
