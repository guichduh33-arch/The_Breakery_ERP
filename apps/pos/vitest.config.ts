import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    passWithNoTests: true,
    setupFiles: ['./vitest.setup.ts'],
    // Session 9 — module graph grew (promotions feature + auto-eval orchestrator
    // pulled into ActiveOrderPanel, PaymentTerminal, useCheckout). Under heavy
    // parallel load the larger collect/setup cost pushes some smoke tests past
    // the 5s default. Bump globally; assertion-level timeouts are unaffected.
    testTimeout: 15000,
    hookTimeout: 15000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx', 'src/**/*.test.{ts,tsx}']
    }
  }
});
