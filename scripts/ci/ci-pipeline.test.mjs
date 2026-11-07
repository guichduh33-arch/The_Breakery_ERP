import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LANES, runLane, testScope, testTasks } from './ci-tests.mjs';
import { gate, REQUIRED } from './ci-gate.mjs';
import { timingSummary } from './ci-summary.mjs';

const base = 'a'.repeat(40);
const task = (pkg, command = 'vitest run') => ({ task: 'test', package: pkg, taskId: `${pkg}#test`, command });
const plan = { tasks: ['@breakery/app-backoffice', '@breakery/app-pos', '@breakery/domain',
  '@breakery/print-bridge', '@breakery/supabase-tests', '@breakery/ui', '@breakery/utils', '@other/future'].map((pkg) => task(pkg)) };

test('CI : les voies partitionnent tous les tests sans doublon, nouveaux packages compris', () => {
  const selected = LANES.flatMap((lane) => testTasks(plan, lane, true));
  assert.deepEqual(selected.sort(), plan.tasks.map((item) => item.taskId).sort());
  assert.equal(new Set(selected).size, selected.length);
  assert.deepEqual(testTasks({ tasks: [task('@breakery/supabase', '<NONEXISTENT>')] }, 'shared'), []);
  assert.throws(() => testTasks({ tasks: [] }, 'shared', true), /BO ou POS/);
  for (const invalid of [null, {}, { tasks: [task('--injected')] }, { tasks: [task('@breakery/ui'), task('@breakery/ui')] },
    { tasks: [{ ...task('@breakery/ui'), taskId: '@breakery/app-pos#test' }] }]) {
    assert.throws(() => testTasks(invalid, 'shared'));
  }
});

test('CI : PR ciblée sur la base exacte, suite complète sur push et changement de son outillage', () => {
  assert.deepEqual(testScope('pull_request', base, ['apps/pos/src/a.ts']),
    { full: false, force: false, filter: [`--filter=...[${base}]`] });
  assert.deepEqual(testScope('push'), { full: true, force: false, filter: [] });
  for (const path of ['.github/workflows/ci.yml', '.github/actions/ci-setup/action.yml',
    'scripts/ci/ci-tests.mjs', 'scripts/ci/ci-pipeline.test.mjs']) {
    assert.deepEqual(testScope('pull_request', base, [path]), { full: true, force: true, filter: [] });
  }
  assert.throws(() => testScope('pull_request', 'origin/master'));
  assert.throws(() => testScope('unknown', base));
});

test('CI : erreur de test propagée, plan illisible refusé, voie non affectée explicite', () => {
  const commands = [], summaries = [];
  assert.equal(runLane({ lane: 'pos', scope: testScope('push'), summarize: (text) => summaries.push(text),
    turbo: (args, capture) => { commands.push(args); return capture ? JSON.stringify(plan) : 7; } }), 7);
  assert.deepEqual(commands[1], ['run', '@breakery/app-pos#test', '--continue=dependencies-successful']);
  assert.match(summaries[0], /@breakery\/app-pos#test/);
  assert.throws(() => runLane({ lane: 'shared', scope: testScope('push'), turbo: () => 'bad JSON' }));
  assert.throws(() => runLane({ lane: 'pos', scope: testScope('push'),
    turbo: (_, capture) => capture ? JSON.stringify(plan) : null }), /interrompue/);
  assert.equal(runLane({ lane: 'pos', scope: testScope('pull_request', base),
    summarize: (text) => assert.match(text, /No affected/),
    turbo: (_, capture) => { assert.ok(capture); return '{"tasks":[]}'; } }), 0);
  runLane({ lane: 'pos', scope: testScope('pull_request', base, ['scripts/ci/ci-tests.mjs']),
    turbo: (args, capture) => { if (capture) return JSON.stringify(plan); assert.ok(args.includes('--force')); return 0; } });
});

test('CI : un seul job absent, rouge, annulé ou ignoré bloque le contrôle requis', () => {
  const needs = Object.fromEntries(REQUIRED.map((name) => [name, { result: 'success' }]));
  assert.match(gate(needs), /passed/);
  for (const name of REQUIRED) for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
    const copy = structuredClone(needs);
    if (result) copy[name].result = result; else delete copy[name];
    assert.throws(() => gate(copy), new RegExp(name));
  }
  assert.throws(() => gate(null));
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./ci-gate.mjs', import.meta.url))],
    { encoding: 'utf8', env: { ...process.env, CI_NEEDS: '{}', GITHUB_STEP_SUMMARY: '' } });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
});

test('CI : diagnostic horodaté, lien direct et étape en échec, sans additionner les voies', () => {
  const report = timingSummary([{ id: 1, name: 'tests | POS', conclusion: 'failure',
    started_at: '2026-11-07T15:00:00Z', completed_at: '2026-11-07T15:04:20Z',
    steps: [{ name: 'Unit tests', conclusion: 'failure' }] }, { id: 2, name: 'gate', status: 'in_progress' }], 'https://example.test/run');
  assert.match(report, /260/);
  assert.match(report, /Unit tests/);
  assert.match(report, /https:\/\/example.test\/run\/job\/1/);
  assert.match(report, /pending/);
  assert.doesNotMatch(report, /tests \| POS/);
});

test('CI : contrôle final inconditionnel, voies obligatoires, caches séparés et contrat de release conservé', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
  const section = (name) => workflow.split(`\n  ${name}:\n`)[1]?.split(/\n  [a-z][a-z-]*:\n/)[0];
  const final = section('lint-typecheck-test-build');
  assert.match(final, /if: \$\{\{ always\(\) \}\}/);
  assert.match(final, /needs: \[governance-guards, lint, typecheck, unit-tests, build\]/);
  assert.match(final, /CI_NEEDS: \$\{\{ toJSON\(needs\) \}\}/);
  assert.match(final, /- name: Require every mandatory job\n\s+if: always\(\)\n\s+run: node scripts\/ci\/ci-gate.mjs/);
  for (const name of REQUIRED) {
    const job = section(name);
    assert.ok(job, name);
    assert.doesNotMatch(job, /continue-on-error: true/);
  }
  assert.match(section('unit-tests'), /fail-fast: false/);
  assert.match(section('unit-tests'), /lane: \[backoffice, pos, shared\]/);
  assert.match(section('governance-guards'), /ci-\*\.test\.mjs/);
  assert.match(section('lint'), /xargs -0 -r -n 40/);
  assert.match(section('lint-advisory'), /continue-on-error: true/);
  const setup = readFileSync(new URL('../../.github/actions/ci-setup/action.yml', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
  assert.match(setup, /inputs.cache-scope/);
  assert.match(setup, /pnpm install --frozen-lockfile/);
  assert.match(setup, /uses: pnpm\/action-setup@v6\n\s+- uses:/);
});
