import { defineConfig } from 'vite';

export default defineConfig({
  root: 'frontend',
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/socket.io': {
        target: 'ws://localhost:3000',
        ws: true
      }
    }
  },
  build: {
    outDir: '../dist', // Hasil build akan ditaruh di root/dist, bukan frontend/dist
    emptyOutDir: true,
  }
});
