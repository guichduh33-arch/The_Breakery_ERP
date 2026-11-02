import { existsSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { inside } from './lib.mjs';

export function writeDeliveryReport(root, input, report) {
  const normalized = input.replaceAll('\\', '/');
  if (!normalized.startsWith('.release-manifests/delivery/')) throw new Error('Sortie réservée à .release-manifests/delivery/.');
  const directory = join(root, '.release-manifests/delivery');
  const target = inside(directory, normalized.slice('.release-manifests/delivery/'.length));
  const parts = relative(root, dirname(target)).split(/[\\/]/);
  let parent = root;
  for (const part of parts) {
    parent = join(parent, part);
    if (existsSync(parent)) {
      const stat = lstatSync(parent);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Répertoire de preuve lié ou invalide.');
    }
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(report, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
}
