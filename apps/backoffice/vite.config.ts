import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  envDir: path.resolve(__dirname, '../..'),
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') }
  },
  // Le port par défaut reste 5174 ; la variable PORT (posée par un harness de
  // preview quand 5174 est occupé) le déroge sans toucher au workflow manuel.
  server: { port: Number(process.env.PORT ?? 5174), host: true },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        // Split the heavy, independently-cacheable vendors out of the
        // per-route chunks; a stable react-vendor chunk maximizes long-term
        // cache hits across deploys.
        //
        // `charts` et `xlsx` ne sont tirés que par des imports DYNAMIQUES : ils
        // ne descendent donc jamais avec le premier chargement. Ce n'était pas
        // vrai pour `charts` jusqu'au 2026-08-21 — le Dashboard, page
        // d'atterrissage après connexion, importait ses deux graphes en
        // statique et payait 443 Ko bruts / 117 Ko gzip à l'ouverture. La
        // promesse ne tient que tant qu'aucune route non-`lazy` n'importe
        // recharts en statique : la vérifier au build, pas ici.
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
          // Vendors éagers mais STABLES entre déploiements (mesure 2026-08-28) :
          // ils vivaient dans le chunk d'entrée applicatif, dont le hash change à
          // chaque édition de code — chaque déploiement refaisait télécharger
          // ~147 Ko gzip au lieu des ~45 Ko de code applicatif réel. Groupe
          // volontairement restreint aux paquets déjà ENTIÈREMENT éagers :
          // y ajouter un paquet partiellement lazy (radix, lucide) grossirait le
          // premier chargement au lieu d'améliorer le cache.
          if (/[\\/]node_modules[\\/](@supabase|zod|sonner|zustand|@tanstack|iceberg-js|tslib)[\\/]/.test(id))
            return 'data-vendor';
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
