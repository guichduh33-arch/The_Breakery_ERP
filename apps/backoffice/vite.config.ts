import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') }
  },
  server: { port: 5174, host: true },
  test: {
    environment: 'jsdom',
    // Use forks pool to avoid Windows VirtualAlloc OOM with multiple threads
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    setupFiles: [],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
});
