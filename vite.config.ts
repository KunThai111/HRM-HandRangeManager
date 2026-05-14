import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// VITE_DEPLOY_TARGET selects the build base path:
//   - "server" / "railway" / "root": "/" (any same-origin host like Railway)
//   - default (GitHub Pages): "/HRM-HandRangeManager/"
function resolveBase(command: 'build' | 'serve'): string {
  if (command !== 'build') return '/';
  const target = process.env.VITE_DEPLOY_TARGET;
  if (target === 'server' || target === 'railway' || target === 'root') return '/';
  return '/HRM-HandRangeManager/';
}

export default defineConfig(({ command }) => ({
  base: resolveBase(command),
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    open: false,
    proxy: {
      // Forward auth + api traffic to the local Node server during dev so cookies
      // stay first-party (no CORS surprises) at http://localhost:5173.
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: false,
      },
      '/auth': {
        target: 'http://localhost:3001',
        changeOrigin: false,
      },
    },
  },
}));
