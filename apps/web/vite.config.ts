import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dev server proxies API + auth to the Express API so the browser sees a single
// origin — no CORS, and the owner session cookie just works.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/auth': 'http://localhost:3000',
    },
  },
});
