import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { ROOT, inside, isMain } from './lib.mjs';
import { findPackage } from './context.mjs';

export function testEvidence(report) {
  const passed = report.numPassedTests ?? 0;
  const failed = report.numFailedTests ?? 0;
  const skipped = (report.numPendingTests ?? 0) + (report.numTodoTests ?? 0);
  return { passed, failed, skipped, valid: report.success === true && passed > 0 && failed === 0 };
}
export function liveAllowed(pkg, allowed, env) {
  if (pkg !== '@breakery/supabase-tests') return;
  if (!allowed) throw new Error('Tests live : --allow-dev-mutations et autorisation du propriétaire requis.');
  const urls = [env.SUPABASE_URL, env.VITE_SUPABASE_URL].filter(Boolean);
  if (!urls.length || urls.some((url) => url !== 'https://ikcyvlovptebroadgtvd.supabase.co') || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Tests live : cible dev V3 explicite et credentials requis ; valeurs jamais affichées.');
  }
}
export function runTest(input, allowed = false) {
  const file = inside(ROOT, input);
  if (!existsSync(file) || !/\.(test|spec)\.[cm]?[jt]sx?$/.test(file)) throw new Error('Un fichier de test existant est requis.');
  const pkg = findPackage(file);
  if (!pkg) throw new Error('Package de test introuvable.');
  liveAllowed(pkg.name, allowed, process.env);
  const runner = join(pkg.dir, 'node_modules/vitest/vitest.mjs');
  if (!existsSync(runner)) throw new Error('Vitest absent : installer les dépendances séparément après diagnostic.');
  const temp = mkdtempSync(join(tmpdir(), 'breakery-test-evidence-'));
  try {
    const output = join(temp, 'report.json');
    const result = spawnSync(process.execPath, [runner, 'run', relative(pkg.dir, file), '--passWithNoTests=false',
      '--reporter=default', '--reporter=json', `--outputFile=${output}`], { cwd: pkg.dir, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (!existsSync(output)) throw new Error('Aucune preuve de test produite.');
    const evidence = testEvidence(JSON.parse(readFileSync(output, 'utf8')));
    console.log(JSON.stringify({ package: pkg.name, ...evidence }));
    return result.status === 0 && evidence.valid ? 0 : 1;
  } finally {
    // Uniquement le répertoire créé par mkdtemp dans cet appel.
    rmSync(temp, { recursive: true, force: true });
  }
}
if (isMain(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const paths = args.filter((arg) => arg !== '--allow-dev-mutations');
    if (paths.length !== 1) throw new Error('Usage : node scripts/agents/test.mjs <fichier-test> [--allow-dev-mutations]');
    process.exitCode = runTest(paths[0], args.includes('--allow-dev-mutations'));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
