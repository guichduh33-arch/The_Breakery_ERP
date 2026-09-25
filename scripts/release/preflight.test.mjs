import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkRelease, REQUIRED_JOBS, REQUIRED_PROTECTION, REQUIRED_DB_JOBS, successfulRun, validateProtection, validateProject } from './preflight.mjs';
import { verifyBuild } from './verify-build.mjs';

const sha = 'a'.repeat(40);
const head = 'b'.repeat(40);
const projectRef = 'c'.repeat(20);
const rules = [{ type: 'pull_request' }, { type: 'required_status_checks', parameters: {
  required_status_checks: REQUIRED_PROTECTION.map((context) => ({ context })),
} }];
const environment = { protection_rules: [{ type: 'required_reviewers', reviewers: [{ id: 1 }] }] };
const jobs = REQUIRED_JOBS.map((name) => ({ name, status: 'completed', conclusion: 'success' }));
const run = { id: 1, head_sha: sha, event: 'push', status: 'completed', conclusion: 'success' };

test('release : SHA exact, dernier run et jobs obligatoires réussis', () => {
  assert.equal(successfulRun([run], sha, 'push', jobs).id, 1);
  assert.throws(() => successfulRun([run], head, 'push', jobs));
  assert.throws(() => successfulRun([run, { ...run, id: 2, conclusion: 'failure' }], sha, 'push', jobs));
  assert.throws(() => successfulRun([{ ...run, status: 'in_progress' }], sha, 'push', jobs));
  assert.throws(() => successfulRun([run], sha, 'push', [{ ...jobs[0], conclusion: 'skipped' }, jobs[1]]));
  assert.throws(() => successfulRun([run], sha, 'push', []));
});
test('release : refus sans PR obligatoire, contrôles et approbateur', () => {
  assert.doesNotThrow(() => validateProtection(rules, environment));
  assert.throws(() => validateProtection([], environment));
  assert.throws(() => validateProtection([{ type: 'pull_request' }, { type: 'required_status_checks',
    parameters: { required_status_checks: REQUIRED_JOBS.map((context) => ({ context })) } }], environment));
  assert.throws(() => validateProtection(rules, { protection_rules: [] }));
  for (const ref of ['', 'ikcyvlovptebroadgtvd', 'abjabuniwkqpfsenxljp']) assert.throws(() => validateProject(ref));
});
test('release : pgTAP du SHA candidat même après une PR frontend, sans mutation cloud', async () => {
  const visited = [];
  let dbRun = null;
  let branchSha = sha;
  let dbJobs = REQUIRED_DB_JOBS.map((name) => ({ name, status: 'completed', conclusion: 'success' }));
  const get = async (path) => {
    visited.push(path);
    if (path === 'branches/master') return { commit: { sha: branchSha } };
    if (path.startsWith('rules/branches/master')) return rules;
    if (path === 'environments/Production') return environment;
    if (path.startsWith('actions/workflows/ci.yml')) return { workflow_runs: [run] };
    if (path.startsWith('actions/runs/1/jobs')) return { jobs };
    if (path.startsWith(`commits/${sha}/pulls`)) return [{ number: 2, merged_at: 'now', merge_commit_sha: sha, base: { ref: 'master' }, head: { sha: head } }];
    if (path.startsWith('actions/workflows/pgtap-pr.yml')) return { workflow_runs: dbRun ? [dbRun] : [] };
    if (path.startsWith('actions/runs/2/jobs')) return { jobs: dbJobs };
    throw new Error(`Unexpected GET ${path}`);
  };
  await assert.rejects(() => checkRelease({ sha, projectRef, get }), /Preuve absente/);
  dbRun = { ...run, id: 2, event: 'workflow_dispatch', head_sha: head };
  await assert.rejects(() => checkRelease({ sha, projectRef, get }), /Preuve absente/);
  dbRun.head_sha = sha;
  assert.equal((await checkRelease({ sha, projectRef, get })).proofs.length, 2);
  branchSha = head;
  await assert.rejects(() => checkRelease({ sha, projectRef, get }), /tête actuelle/);
  branchSha = sha;
  const completeDbJobs = dbJobs;
  dbJobs = dbJobs.filter((job) => job.name !== 'db-gate');
  await assert.rejects(() => checkRelease({ sha, projectRef, get }), /db-gate/);
  dbJobs = completeDbJobs.map((job) => ({ ...job, conclusion: job.name === 'db-gate' ? 'skipped' : 'success' }));
  await assert.rejects(() => checkRelease({ sha, projectRef, get }), /db-gate/);
  dbJobs = completeDbJobs;
  dbRun.conclusion = 'failure';
  await assert.rejects(() => checkRelease({ sha, projectRef, get }), /échoué/);
  assert.ok(visited.every((path) => !path.includes('dispatches')));
  await assert.rejects(() => checkRelease({ sha: 'bad', projectRef, get }), /SHA/);
});
test('bundle : refuser dev, mauvaise cible et sortie ne provenant pas du BO', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'breakery-release-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'apps/backoffice/dist'), { recursive: true });
  mkdirSync(join(root, '.vercel/output/static'), { recursive: true });
  writeFileSync(join(root, 'apps/backoffice/dist/index.html'), '<html>BO</html>');
  writeFileSync(join(root, '.vercel/output/static/index.html'), '<html>BO</html>');
  const bundle = join(root, '.vercel/output/static/app.js');
  writeFileSync(bundle, `const url="https://${projectRef}.supabase.co"`);
  writeFileSync(join(root, 'apps/backoffice/dist/app.js'), `const url="https://${projectRef}.supabase.co"`);
  assert.equal(verifyBuild(root, projectRef).verified, true);
  writeFileSync(bundle, 'const url="https://ikcyvlovptebroadgtvd.supabase.co"');
  writeFileSync(join(root, 'apps/backoffice/dist/app.js'), 'const url="https://ikcyvlovptebroadgtvd.supabase.co"');
  assert.throws(() => verifyBuild(root, projectRef), /bundle/);
  writeFileSync(join(root, '.vercel/output/static/index.html'), '<html>POS</html>');
  assert.throws(() => verifyBuild(root, projectRef), /BO/);
});
