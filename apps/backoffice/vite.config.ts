import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  envDir: path.resolve(__dirname, '../..'),
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') }
  },
  server: { port: 5174, host: true },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        // Split the heavy, independently-cacheable vendors out of the
        // per-route chunks. recharts/xlsx are only pulled by lazy report and
        // import/export pages, so they stay out of the initial download; a
        // stable react-vendor chunk maximizes long-term cache hits across deploys.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id))
            return 'react-vendor';
          // Tiny styling utils used eagerly by @breakery/ui's cn()/cva. Pin them
          // to the eager react-vendor chunk so Rollup can't sweep them into a
          // lazy lib chunk (recharts also imports clsx) and drag it into the
          // initial modulepreload.
          if (/[\\/]node_modules[\\/](clsx|tailwind-merge|class-variance-authority|tailwind-variants)[\\/]/.test(id))
            return 'react-vendor';
          // Only recharts itself — NOT its d3-* deps. A shared d3 utility used
          // by an eager formatter would otherwise drag the whole chart chunk
          // into the initial modulepreload. d3 utils chunk naturally instead.
          if (/[\\/]node_modules[\\/]recharts[\\/]/.test(id)) return 'charts';
          if (/[\\/]node_modules[\\/]xlsx[\\/]/.test(id)) return 'xlsx';
          if (/[\\/]node_modules[\\/]@sentry[\\/]/.test(id)) return 'sentry';
          return undefined;
        },
      },
    },
  },
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
