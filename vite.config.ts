import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { realpathSync } from 'fs';
import path from 'path';
import { defineConfig } from 'vite';

const projectRoot = realpathSync(path.resolve(import.meta.dirname));

export default defineConfig({
  root: projectRoot,
  plugins: [react(), tailwindcss()],
  server: {
    // Vite serves the frontend; Wrangler owns the real Worker/D1/R2 API.
    // Proxy only in development, keeping browser calls on the same origin.
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true },
      '/media': { target: 'http://127.0.0.1:8787', changeOrigin: true },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(projectRoot, './src'),
    },
  },
});
