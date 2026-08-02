import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

/**
 * The backend (src/orchiday/server.py) serves `/` from web/index.html and
 * mounts everything else in web/ under `/static`. So the build has to write
 * into ../web with base `/static/` — that keeps the server free of any
 * knowledge about how the frontend is built.
 *
 * The built output is COMMITTED. Orchiday has to run for someone who cloned
 * the repo and has Python but no Node, exactly like the compiled web/app.js
 * was committed before this migration. `npm run build` is only needed by
 * whoever edits frontend/src.
 *
 * Asset filenames carry a content hash, which is what makes a stale cached
 * bundle impossible — it replaces the manual `?v=X.Y.Z` bumping that the
 * hand-written index.html needed.
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/static/',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: fileURLToPath(new URL('../web', import.meta.url)),
    emptyOutDir: true,
    // No source map in the committed build: it is a 2 MB file that would be
    // rewritten on every single build and live in git history forever.
    // `npm run dev` serves unbundled sources, which is where debugging happens
    // anyway.
    sourcemap: false,
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
  server: {
    port: 5173,
    // `npm run dev` serves the UI but not the API. Proxy both to a backend
    // started with `orchiday` so the dev server is actually usable.
    proxy: {
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:8000', ws: true },
    },
  },
});
