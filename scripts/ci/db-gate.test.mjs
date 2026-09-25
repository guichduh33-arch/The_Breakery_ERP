import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changedPaths, classify, gate } from './db-gate.mjs';

const base = 'a'.repeat(40), head = 'b'.repeat(40);
const event = { pull_request: { base: { sha: base }, head: { sha: head } } };
function scope(diff, extra = {}) {
  return classify({ eventName: 'pull_request', event, readDiff: (from, to) => {
    assert.equal(from, base); assert.equal(to, head); return diff;
  }, ...extra });
}

test('DB : frontend seul hors périmètre, ajouts/modifications/suppressions DB applicables', () => {
  assert.equal(scope('M\0apps/backoffice/src/app.tsx\0').reason, 'not-applicable');
  assert.equal(scope('').applicable, false);
  for (const status of ['A', 'M', 'D', 'T']) for (const zone of ['migrations', 'functions', 'tests'])
    assert.equal(scope(`${status}\0supabase/${zone}/example.sql\0`).applicable, true);
});
test('DB : les deux côtés des renommages et copies sont analysés sans découper les noms', () => {
  assert.equal(scope('R100\0supabase/tests/old.test.sql\0scripts/new.sql\0').applicable, true);
  assert.equal(scope('R090\0scripts/old.sql\0supabase/tests/new.test.sql\0').applicable, true);
  assert.equal(scope('C100\0supabase/functions/example.ts\0scripts/copy.ts\0').applicable, true);
  assert.deepEqual(changedPaths('M\0apps/name with\nspace.ts\0'), ['apps/name with\nspace.ts']);
});
test('DB : propre workflow/classificateur couverts, manuel toujours applicable, aucune exemption bot', () => {
  for (const path of ['.github/workflows/pgtap-pr.yml', 'scripts/ci/db-gate.mjs', 'scripts/ci/db-gate.test.mjs'])
    assert.equal(scope(`M\0${path}\0`).applicable, true);
  assert.equal(scope('M\0supabase/tests/example.sql\0', { event: { ...event, sender: { login: 'dependabot[bot]' } } }).applicable, true);
  assert.deepEqual(classify({ eventName: 'workflow_dispatch', readDiff: () => assert.fail('pas de diff manuel') }),
    { applicable: true, reason: 'manual', paths: [] });
});
test('DB : erreur de diff, statut inconnu, événement invalide et SHA absent échouent', () => {
  for (const diff of ['M\0', 'M\0file', 'R100\0old\0', 'Z\0file\0']) assert.throws(() => scope(diff));
  assert.throws(() => scope('', { event: {} }));
  assert.throws(() => scope('', { eventName: 'push' }));
  assert.throws(() => scope('', { readDiff: () => { throw new Error('diff indisponible'); } }));
});
test('db-gate : seuls un non-applicable justifié ou une réussite effective sont verts', () => {
  const valid = { classification: 'success', applicable: 'true', reason: 'db-changes', pgtap: 'success' };
  assert.match(gate(valid), /réellement réussi/);
  assert.match(gate({ ...valid, reason: 'manual' }), /réellement réussi/);
  assert.match(gate({ ...valid, applicable: 'false', reason: 'not-applicable', pgtap: 'skipped' }), /non applicable/);
  for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
    assert.throws(() => gate({ ...valid, classification: result }));
    assert.throws(() => gate({ ...valid, pgtap: result }));
  }
  for (const applicable of ['', undefined, 'unknown']) assert.throws(() => gate({ ...valid, applicable }));
  assert.throws(() => gate({ ...valid, applicable: 'false' }));
  assert.throws(() => gate({ ...valid, reason: undefined }));
});
