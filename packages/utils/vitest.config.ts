import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      thresholds: { lines: 85, statements: 85, functions: 85, branches: 80 },
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts']
    }
  }
});
