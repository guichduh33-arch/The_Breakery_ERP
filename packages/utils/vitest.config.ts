import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',           // changed from 'node'
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      thresholds: { lines: 85, statements: 85, functions: 85, branches: 75 },
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts']
    }
  }
});
