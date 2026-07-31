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
    // Aligné sur apps/pos et packages/ui : turbo lance les suites des packages
    // en parallèle, et la contention CPU du runner multiplie par ~8 le coût d'un
    // test jsdom lourd — Sidebar.test « 8 renames » (667 ms en local, 9 requêtes
    // getByRole sur tout l'arbre d'accessibilité) dépassait le défaut de 5s.
    // Marge de timeout uniquement, aucun changement d'assertion ni de couverture.
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
