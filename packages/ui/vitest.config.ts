import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    passWithNoTests: true,
    setupFiles: ['./vitest.setup.ts'],
    // Vitest 3 (pool forks) : sous charge parallèle + coverage, le rendu jsdom
    // des modales Radix dépasse les 5 s par défaut — même remède que apps/pos.
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      thresholds: { lines: 70, statements: 70, functions: 70, branches: 60 },
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/index.ts']
    }
  }
});
