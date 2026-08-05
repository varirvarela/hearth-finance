import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  base: process.env.GITHUB_ACTIONS ? '/hearth-finance/' : '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
});
