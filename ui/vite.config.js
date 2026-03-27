import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('lightweight-charts')) return 'vendor-lightweight-charts';
          if (id.includes('recharts') || id.includes('d3-')) return 'vendor-recharts';
          if (
            id.includes('/react/') ||
            id.includes('react-dom') ||
            id.includes('react/jsx-runtime') ||
            id.includes('/scheduler/') ||
            id.includes('use-sync-external-store')
          ) {
            return 'vendor-react';
          }
          return 'vendor-misc';
        },
      },
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api/v1': 'http://localhost:8081',
      '/graphql': 'http://localhost:8085',
      '/api/marketdata': 'http://localhost:8087',
      '/api/analysis': 'http://localhost:8088',
      '/api/backtest': 'http://localhost:8089',
      '/ws': {
        target: 'ws://localhost:8085',
        ws: true,
      },
    },
  },
});
