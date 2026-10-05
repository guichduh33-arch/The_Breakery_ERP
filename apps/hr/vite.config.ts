import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  envDir: '.',
  envPrefix: 'VITE_HR_',
  server: { host: '127.0.0.1', port: 5180, strictPort: true },
  build: { target: 'es2022' },
  test: { environment: 'node', maxWorkers: 1 },
});
