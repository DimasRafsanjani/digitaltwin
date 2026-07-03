import { defineConfig } from 'vite';

export default defineConfig({
  root: 'frontend',
  build: {
    outDir: '../dist', // Hasil build akan ditaruh di root/dist, bukan frontend/dist
    emptyOutDir: true,
  }
});
