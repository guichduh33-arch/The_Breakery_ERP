import { spawnSync } from 'node:child_process';
import { isMain } from '../agents/lib.mjs';
import { validateProject, validateSha } from './preflight.mjs';

/** Les deux modes utilisent les mêmes précontrôles et le même bundle vérifié. */
export function deploymentArgs(env) {
  validateSha(env.RELEASE_SHA);
  validateProject(env.SUPABASE_PROJECT_REF_PRODUCTION);
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REF !== 'refs/heads/master' ||
      env.RELEASE_ENABLED !== 'true' || env.RELEASE_APPROVED !== 'true') {
    throw new Error('Publication réservée au workflow Production approuvé sur master.');
  }
  for (const name of ['VERCEL_TOKEN', 'VERCEL_ORG_ID', 'VERCEL_PROJECT_ID']) {
    if (typeof env[name] !== 'string' || !env[name].trim()) throw new Error(`Configuration absente : ${name}`);
  }
  const mode = env.RELEASE_STAGE_ONLY ?? 'false';
  if (!['true', 'false'].includes(mode)) throw new Error('RELEASE_STAGE_ONLY doit être true ou false.');
  return ['deploy', '--prebuilt', '--prod', '--yes',
    ...(mode === 'true' ? ['--skip-domain'] : []), '--meta', `githubCommitSha=${env.RELEASE_SHA}`];
}

export function deployBackoffice(env, execute = spawnSync) {
  // Le jeton reste dans l'environnement ; il n'entre ni dans les arguments ni dans le reçu.
  const result = execute('vercel', deploymentArgs(env), { env, stdio: 'inherit' });
  if (result.error) throw new Error('Vercel CLI indisponible.', { cause: result.error });
  if (result.status !== 0) throw new Error(`Déploiement Vercel non réussi (code ${result.status ?? 'inconnu'}).`);
  return { sourceSha: env.RELEASE_SHA, staged: env.RELEASE_STAGE_ONLY === 'true' };
}

if (isMain(import.meta.url)) {
  try { console.log(JSON.stringify(deployBackoffice(process.env))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
