import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Separate platform-admin app. Runs on its own port and proxies the global admin
// endpoints to the API. It never imports or ships any customer/staff code.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/admin': 'http://localhost:3000',
      '/auth/admin': 'http://localhost:3000',
    },
  },
});
