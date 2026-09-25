import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, git, isMain } from './lib.mjs';
import { syncMirrors } from './sync.mjs';

export function doctor(root = ROOT) {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const installed = join(root, 'node_modules/.modules.yaml');
  const modules = existsSync(installed) ? readFileSync(installed, 'utf8') : '';
  const installedManager = modules.match(/(?:"?packageManager"?):\s*["']?([^"'\r\n]+)/)?.[1] ?? null;
  const worktrees = git(['worktree', 'list', '--porcelain'], root).split('\n\n').filter(Boolean).map((entry) => {
    const lines = entry.split(/\r?\n/);
    const path = lines.find((line) => line.startsWith('worktree '))?.slice(9);
    try {
      return { path, head: lines.find((line) => line.startsWith('HEAD '))?.slice(5),
        branch: lines.find((line) => line.startsWith('branch '))?.slice(7) ?? 'detached',
        status: git(['status', '--short', '--untracked-files=normal'], path).split('\n').filter(Boolean) };
    } catch { return { path, error: 'État inaccessible ; ne pas conclure propre ou supprimable.' }; }
  });
  const mirrors = syncMirrors(root);
  return { sha: git(['rev-parse', 'HEAD'], root), branch: git(['branch', '--show-current'], root),
    node: { running: process.version, required: manifest.engines.node },
    pnpm: { required: manifest.packageManager, installed: installedManager, matches: installedManager === manifest.packageManager },
    worktrees, mirrors,
    envFilesPresent: Object.fromEntries(['.env', 'apps/pos/.env.local', 'apps/backoffice/.env.local']
      .map((file) => [file, existsSync(join(root, file))])),
    testRunnersPresent: Object.fromEntries(['apps/pos', 'apps/backoffice', 'packages/supabase', 'supabase/tests']
      .map((dir) => [dir, existsSync(join(root, dir, 'node_modules/vitest/vitest.mjs'))])),
    note: 'Lecture seule : aucune installation, aucun nettoyage, aucun test ni valeur de secret.' };
}
if (isMain(import.meta.url)) {
  try {
    const result = doctor();
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.mirrors.changed.length || result.mirrors.orphaned.length || !result.pnpm.matches ? 1 : 0;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
