#!/usr/bin/env node
// Report the actual static JS closure of each POS route, including shared chunks.
// Dynamic imports are charged to their own route/modal, not to every initial load.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dist = resolve(root, 'apps/pos/dist');
const manifest = JSON.parse(readFileSync(resolve(dist, '.vite/manifest.json'), 'utf8'));
const initial = Object.entries(manifest).find(([, chunk]) => chunk.isEntry)?.[0];
if (!initial) throw new Error('POS manifest has no entry. Run the POS build first.');
const routes = { login: initial, pos: 'src/pages/Pos.tsx', tablet: 'src/features/tablet/TabletOrderPage.tsx', kds: 'src/pages/Kds.tsx', display: 'src/features/display/CustomerDisplayPage.tsx', reports: 'src/features/reports/POSReportsOverviewPage.tsx' };
function closure(key, files = new Set()) {
  const name = key.split('/').pop().replace(/\.tsx?$/, '');
  const chunk = manifest[key] ?? Object.values(manifest).find((entry) => entry.name === name && entry.isDynamicEntry);
  if (!chunk) throw new Error(`Missing route chunk: ${key}`);
  if (files.has(chunk.file)) return files;
  files.add(chunk.file);
  for (const imported of chunk.imports ?? []) closure(imported, files);
  return files;
}
const rows = Object.entries(routes).map(([route, key]) => {
  const files = closure(key, closure(initial));
  if (route === 'tablet') closure('src/pages/tablet/TabletLayout.tsx', files);
  const buffers = [...files].map((file) => readFileSync(resolve(dist, file)));
  return { route, files: files.size, bytes: buffers.reduce((sum, data) => sum + data.length, 0), gzipBytes: buffers.reduce((sum, data) => sum + gzipSync(data).length, 0) };
});
console.table(rows.map((row) => ({ route: row.route, chunks: row.files, jsKB: +(row.bytes / 1000).toFixed(1), gzipKB: +(row.gzipBytes / 1000).toFixed(1) })));
writeFileSync(resolve(dist, 'route-budgets.json'), `${JSON.stringify(rows, null, 2)}\n`);
