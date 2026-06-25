import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: {
    fs: {
      // Allow vite to serve files from the pnpm virtual store so @supabase/*
      // sub-packages (functions-js, postgrest-js, …) resolve correctly when
      // test files live outside this package directory.
      allow: ['../..'],
    },
  },
  test: {
    environment: 'node',
    passWithNoTests: true,
    // External-ise all @supabase/* packages so vite doesn't try to inline/bundle
    // them from an unknown resolution path when running tests in ../../supabase/tests/.
    server: {
      deps: {
        external: [/^@supabase\//],
      },
    },
    include: [
      'src/**/*.{test,spec}.ts',
      '../../supabase/tests/functions/**/*.{test,spec}.ts',
    ],
  },
});
