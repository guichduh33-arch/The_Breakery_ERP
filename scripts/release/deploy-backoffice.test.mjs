import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deployBackoffice, deploymentArgs } from './deploy-backoffice.mjs';

const env = {
  RELEASE_SHA: 'a'.repeat(40), SUPABASE_PROJECT_REF_PRODUCTION: 'r'.repeat(20),
  GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/master',
  RELEASE_ENABLED: 'true', RELEASE_APPROVED: 'true', RELEASE_STAGE_ONLY: 'false',
  VERCEL_TOKEN: 'test-only-placeholder', VERCEL_ORG_ID: 'org', VERCEL_PROJECT_ID: 'project',
};

test('master ne déclenche pas une publication Git avant les contrôles du workflow', () => {
  for (const path of ['../../vercel.json', '../../apps/backoffice/vercel.json']) {
    const config = JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
    assert.deepEqual(config.git.deploymentEnabled, { master: false });
  }
});

test('publication normale conservée ; staging ajoute seulement le flag fixe sans bascule de domaine', () => {
  const normal = deploymentArgs(env);
  const staged = deploymentArgs({ ...env, RELEASE_STAGE_ONLY: 'true' });
  assert.deepEqual(normal, ['deploy', '--prebuilt', '--prod', '--yes', '--meta', `githubCommitSha=${env.RELEASE_SHA}`]);
  assert.deepEqual(staged.filter(arg => arg !== '--skip-domain'), normal);
  assert.equal(staged.filter(arg => arg === '--skip-domain').length, 1);
  assert.deepEqual(deploymentArgs({ ...env, RELEASE_STAGE_ONLY: undefined }), normal);
  assert.equal(staged.some(arg => arg.includes(env.VERCEL_TOKEN) || arg.startsWith('--token')), false);
});

test('aucune CLI lancée avec mode ambigu, cible dev, SHA ou confirmation invalide', () => {
  const invalid = [
    { RELEASE_STAGE_ONLY: '' }, { RELEASE_STAGE_ONLY: 'TRUE' }, { RELEASE_STAGE_ONLY: '1' },
    { RELEASE_STAGE_ONLY: '--skip-domain --scope other' }, { RELEASE_SHA: 'master' },
    { SUPABASE_PROJECT_REF_PRODUCTION: 'ikcyvlovptebroadgtvd' },
    { RELEASE_APPROVED: 'false' }, { RELEASE_ENABLED: 'false' },
    { GITHUB_ACTIONS: 'false' }, { GITHUB_REF: 'refs/heads/other' },
    { VERCEL_TOKEN: '' }, { VERCEL_ORG_ID: '' }, { VERCEL_PROJECT_ID: '' },
  ];
  for (const patch of invalid) {
    let called = false;
    assert.throws(() => deployBackoffice({ ...env, ...patch }, () => { called = true; return { status: 0 }; }));
    assert.equal(called, false);
  }
});

test('CLI factice reçoit le bundle préconstruit et son environnement ; aucun reçu réussi après échec', () => {
  const stagedEnv = { ...env, RELEASE_STAGE_ONLY: 'true' };
  let calls = 0;
  assert.deepEqual(deployBackoffice(stagedEnv, (command, args, options) => {
    calls += 1;
    assert.equal(command, 'vercel');
    assert.equal(options.env, stagedEnv);
    assert.equal(options.stdio, 'inherit');
    assert.equal(args.includes('--prebuilt'), true);
    assert.equal(args.includes('--skip-domain'), true);
    return { status: 0 };
  }), { sourceSha: env.RELEASE_SHA, staged: true });
  assert.equal(calls, 1);
  assert.throws(() => deployBackoffice(env, () => ({ status: 7 })), /code 7/);
  assert.throws(() => deployBackoffice(env, () => ({ status: null, error: new Error('missing') })), /indisponible/);
});

test('workflow : protections, précontrôles et manifeste restent communs aux deux modes', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/production-backoffice.yml', import.meta.url), 'utf8')
    .replaceAll('\r\n', '\n');
  assert.match(workflow, /stage_only:\s*\n\s*description:.*\n\s*required: true\n\s*type: boolean\n\s*default: false/);
  assert.match(workflow, /environment: Production/);
  assert.match(workflow, /group: backoffice-production\s*\n\s*cancel-in-progress: false/);
  assert.match(workflow, /RELEASE_STAGE_ONLY: \$\{\{ inputs.stage_only \}\}/);
  assert.equal([...workflow.matchAll(/node scripts\/release\/preflight\.mjs/g)].length >= 2, true);
  const finalPreflight = workflow.lastIndexOf('node scripts/release/preflight.mjs');
  const verifyManifest = workflow.lastIndexOf('node scripts/release/manifest.mjs backoffice --verify');
  const deploy = workflow.lastIndexOf('node scripts/release/deploy-backoffice.mjs');
  assert.equal(finalPreflight < verifyManifest && verifyManifest < deploy, true);
  assert.match(workflow.slice(workflow.lastIndexOf('      - name:')), /set -euo pipefail/);
  assert.doesNotMatch(workflow, /continue-on-error:\s*true|--token(?:=|\s)/);
});
