import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  envDir: path.resolve(__dirname, '../..'),
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') }
  },
  server: { port: 5173, host: true },
  build: { target: 'es2022' },
  // esbuild 0.28+ regression: with Vite's default browser target list,
  // it refuses to transform `let { x, ...rest } = obj` style destructuring
  // even though every supported browser handles it natively. Tell esbuild
  // those features are supported so it skips the transform entirely.
  optimizeDeps: {
    esbuildOptions: {
      target: 'es2022',
      supported: {
        'destructuring': true,
        'object-rest-spread': true,
      },
    },
  },
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
