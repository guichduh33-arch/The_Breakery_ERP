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
const rules = [{ type: 'deletion' }, { type: 'non_fast_forward' },
  { type: 'pull_request', parameters: { required_review_thread_resolution: true, dismiss_stale_reviews_on_push: true } },
  { type: 'required_status_checks', parameters: {
  strict_required_status_checks_policy: true, do_not_enforce_on_create: false,
  required_status_checks: REQUIRED_PROTECTION.map((context) => ({ context, integration_id: 15368 })),
} }];
const environment = { protection_rules: [{ type: 'required_reviewers', reviewers: [{ type: 'User', reviewer: { id: 1 } }] }],
  deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } };
const branches = [{ name: 'master', type: 'branch' }];
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
  assert.doesNotThrow(() => validateProtection(rules, environment, branches));
  assert.throws(() => validateProtection([], environment));
  assert.throws(() => validateProtection([{ type: 'pull_request' }, { type: 'required_status_checks',
    parameters: { required_status_checks: REQUIRED_JOBS.map((context) => ({ context })) } }], environment));
  assert.throws(() => validateProtection(rules, { protection_rules: [] }));
  for (const ref of ['', 'ikcyvlovptebroadgtvd', 'abjabuniwkqpfsenxljp']) assert.throws(() => validateProject(ref));
});
test('release : chaque protection manquante, permissive ou ambiguë bloque', () => {
  for (const rule of rules) {
    assert.throws(() => validateProtection(rules.filter((item) => item !== rule), environment, branches));
  }
  const variants = [
    (r) => { r[2].parameters.required_review_thread_resolution = false; },
    (r) => { delete r[2].parameters.dismiss_stale_reviews_on_push; },
    (r) => { r[3].parameters.strict_required_status_checks_policy = false; },
    (r) => { delete r[3].parameters.strict_required_status_checks_policy; },
    (r) => { r[3].parameters.do_not_enforce_on_create = true; },
    (r) => { r[3].parameters.required_status_checks[0].integration_id = 1; },
    (r) => { delete r[3].parameters.required_status_checks[1].integration_id; },
    (r) => { r[3].parameters.required_status_checks.pop(); },
  ];
  for (const mutate of variants) {
    const copy = structuredClone(rules); mutate(copy);
    assert.throws(() => validateProtection(copy, environment, branches));
  }
  for (const policies of [undefined, [], [{ name: '*', type: 'branch' }],
    [{ name: 'master', type: 'tag' }], [...branches, { name: 'dev', type: 'branch' }]]) {
    assert.throws(() => validateProtection(rules, environment, policies));
  }
  for (const policy of [undefined, { protected_branches: true, custom_branch_policies: false },
    { protected_branches: false, custom_branch_policies: false }]) {
    assert.throws(() => validateProtection(rules, { ...environment, deployment_branch_policy: policy }, branches));
  }
  for (const reviewers of [[], [{}], [{ type: 'User', reviewer: {} }], [{ type: 'App', reviewer: { id: 1 } }]]) {
    assert.throws(() => validateProtection(rules, { ...environment,
      protection_rules: [{ type: 'required_reviewers', reviewers }] }, branches));
  }
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
    if (path.startsWith('environments/Production/deployment-branch-policies')) return { branch_policies: branches };
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
test('release : toutes les pages des branches Production sont lues et une branche cachée bloque', async () => {
  const visited = [];
  const get = async (path) => {
    visited.push(path);
    if (path === 'branches/master') return { commit: { sha } };
    if (path.startsWith('rules/branches/master')) return rules;
    if (path === 'environments/Production') return environment;
    if (path.includes('deployment-branch-policies')) return { branch_policies: path.includes('page=2')
      ? [{ name: 'dev', type: 'branch' }] : Array.from({ length: 100 }, () => branches[0]) };
    assert.fail('must stop before CI inspection');
  };
  await assert.rejects(checkRelease({ sha, projectRef, get }), /master uniquement/);
  assert.ok(visited.some((path) => path.includes('deployment-branch-policies') && path.includes('page=2')));
  await assert.rejects(checkRelease({ sha, projectRef, get: async (path) => {
    if (path.includes('deployment-branch-policies')) throw new Error('HTTP 403');
    return get(path);
  } }), /HTTP 403/);
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
