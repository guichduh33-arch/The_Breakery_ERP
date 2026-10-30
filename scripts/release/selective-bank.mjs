import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isMain, ROOT } from '../agents/lib.mjs';
import { checkRelease } from './preflight.mjs';

// Exception bornée à ce candidat ; aucun SHA ni chemin libre en entrée.
export const BANK_RELEASE = Object.freeze({
  baseline: '6af3822bfcfb0e2efa6de445dc38bdfc0c9838ab',
  candidate: '5e4ab2b2aa5efad4e26dce4acc351c5774d65def',
  production: 'yjhhhmjgsmyzyymvixot',
  rehearsal: 'getctmbpjnrrjzncaqze',
  migration: 'supabase/migrations/20261030000010_bank_historical_clearing.sql',
});
export const BANK_FILES = Object.freeze([
  'apps/backoffice/src/features/accounting/bank-reconciliation/__tests__/bank-api.test.ts',
  'apps/backoffice/src/features/accounting/bank-reconciliation/api.ts',
  'packages/supabase/src/types.generated.ts',
  BANK_RELEASE.migration,
  'supabase/tests/bank_reconciliation.test.sql',
  'supabase/tests/bank_reconciliation_historical.test.sql',
  'supabase/tests/bank_reconciliation_import.test.sql',
  'supabase/tests/bank_reconciliation_net_fee.test.sql',
].sort());

export function inspectBankSource({ controllerSha, git }) {
  if (!/^[a-f0-9]{40}$/.test(controllerSha ?? '')) throw new Error('SHA contrôleur requis.');
  git(['merge-base', '--is-ancestor', BANK_RELEASE.baseline, BANK_RELEASE.candidate]);
  git(['merge-base', '--is-ancestor', BANK_RELEASE.baseline, controllerSha]);
  const changes = git(['diff', '--no-renames', '--name-status', BANK_RELEASE.baseline, BANK_RELEASE.candidate])
    .toString().trim().split('\n').map((line) => line.split('\t'));
  if (changes.some(([status, path, extra]) => !['A', 'M'].includes(status) || !path || extra) ||
      JSON.stringify(changes.map(([, path]) => path).sort()) !== JSON.stringify(BANK_FILES)) {
    throw new Error('Le diff doit contenir exactement les huit fichiers bancaires autorisés.');
  }
  // Une fusion squash ne conserve pas l'ascendance du candidat. Vérifier les
  // sources et tests exacts ; seuls les types générés contiennent aussi la caisse.
  for (const path of BANK_FILES.filter((path) => !path.endsWith('/types.generated.ts'))) {
    if (!git(['show', `${controllerSha}:${path}`]).equals(git(['show', `${BANK_RELEASE.candidate}:${path}`]))) {
      throw new Error(`Contrat bancaire différent dans le contrôleur : ${path}`);
    }
  }
  return {
    schemaVersion: 1, scope: 'bank-only-source-identity', ...BANK_RELEASE, controllerSha,
    files: BANK_FILES.map((path) => ({ path,
      sha256: createHash('sha256').update(git(['show', `${BANK_RELEASE.candidate}:${path}`])).digest('hex'),
    })),
  };
}

// La preuve commune ne devient jamais une preuve SQL du candidat sélectif.
export async function inspectIntegratedRelease({ controllerSha, git, get }) {
  const source = inspectBankSource({ controllerSha, git });
  const integration = await checkRelease({ sha: controllerSha, projectRef: BANK_RELEASE.production, get });
  return { source, integration, publicationAuthorized: false };
}

if (isMain(import.meta.url)) {
  try {
    if (process.env.GITHUB_REF !== 'refs/heads/master') throw new Error('Contrôleur depuis master uniquement.');
    const git = (args) => execFileSync('git', args, { cwd: ROOT, maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
    console.log(JSON.stringify(inspectBankSource({ controllerSha: process.env.GITHUB_SHA, git }), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
