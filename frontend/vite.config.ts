/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig(({ mode }) => ({
  // `npm run dev:phone`: serve over https on the LAN. Phones reach the dev
  // server by IP (not localhost), and browsers only allow geolocation on
  // secure pages - over plain http, "Use current location" always fails.
  // The certificate is self-signed, so the browser warns once.
  plugins: mode === 'phone' ? [basicSsl()] : [],
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
}));
