// apps/print-bridge/tsup.config.ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  target: 'node22',
  clean: true,
  sourcemap: true,
  // Les packages workspace sont du TS source — on les bundle ; les deps npm restent externes.
  noExternal: ['@breakery/domain', '@breakery/utils'],
});
