import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Alias shared package to source so Vite HMR picks up changes.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@cvc/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    host: true,
    port: 5173,
    // Dev: same-origin proxy to the api container (Docker-only).
    proxy: {
      '/api': { target: 'http://api:3000', changeOrigin: true },
      '/socket.io': { target: 'http://api:3000', ws: true, changeOrigin: true },
      '/docs': { target: 'http://api:3000', changeOrigin: true },
      '/health': { target: 'http://api:3000', changeOrigin: true },
      '/ready': { target: 'http://api:3000', changeOrigin: true },
    },
  },
});
