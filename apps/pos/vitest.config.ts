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
    // CI-speedup — 30s (was 15s): turbo now runs the 8 packages' suites in
    // parallel, and the CPU contention 3-4×es a slow jsdom test —
    // void-idempotency-header.smoke (4.5s alone) overran 15s under full
    // parallel load. Timeout headroom only, no coverage change.
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx', 'src/**/*.test.{ts,tsx}']
    }
  }
});
