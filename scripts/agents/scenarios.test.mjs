import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { contextFor } from './context.mjs';
import { ROOT } from './lib.mjs';
import { liveAllowed, testEvidence } from './test.mjs';

function fixture(t, input, files, manifest) {
  const root = mkdtempSync(join(tmpdir(), 'breakery-scenario-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const path of [input, ...files, ...Object.keys(manifest ?? {})]) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), manifest?.[path] ?? '');
  }
  return contextFor(input, root, files);
}
const role = (name) => readFileSync(join(ROOT, '.claude/agents', `${name}.md`), 'utf8').replace(/\s+/g, ' ');

test('scénario BO : package, tests pages/features, skill métier et limite de preuve ciblée', (t) => {
  const files = ['apps/backoffice/src/pages/reports/__tests__/daily-sales.test.tsx',
    'apps/backoffice/src/features/reports/__tests__/daily-sales.test.tsx', 'apps/pos/src/daily-sales.test.ts'];
  const result = fixture(t, 'apps/backoffice/src/pages/reports/DailySalesPage.tsx', files,
    { 'apps/backoffice/package.json': '{"name":"@breakery/app-backoffice"}' });
  assert.equal(result.package, '@breakery/app-backoffice');
  assert.deepEqual(new Set(result.tests), new Set(files.slice(0, 2)));
  assert.ok(result.skillsSuggested.includes('report-audit'));
  assert.match(result.testCommand, /scripts\/agents\/test.mjs/);
  assert.match(role('backoffice-specialist'), /suite BO complète/);
});
test('scénario POS : symptôme ciblé, pas de tests BO ni promesse matérielle', (t) => {
  const file = 'apps/pos/src/features/payment/__tests__/checkout.test.ts';
  const result = fixture(t, 'apps/pos/src/features/payment/useCheckout.ts', [file, 'apps/backoffice/src/checkout.test.ts'],
    { 'apps/pos/package.json': '{"name":"@breakery/app-pos"}' });
  assert.equal(result.package, '@breakery/app-pos'); assert.deepEqual(result.tests, [file]);
  assert.deepEqual(result.skillsSuggested, ['pos-flow-audit']); assert.equal(result.live, false);
  assert.match(role('pos-specialist'), /POS_DIST_DIR/);
  assert.match(role('pos-specialist'), /Ne pas présenter un test mocké/);
});
test('scénario migration : SQL cloud distinct de Vitest, source live et refus du replay global', (t) => {
  const file = 'supabase/tests/payment.test.sql';
  const result = fixture(t, 'supabase/migrations/209901010001_payment.sql',
    [file, 'supabase/tests/unrelated.test.sql', 'apps/pos/src/payment.test.ts']);
  assert.equal(result.package, null); assert.deepEqual(result.tests, [file]);
  assert.deepEqual(result.skillsSuggested, ['db-migrations']); assert.equal(result.testCommand, null);
  assert.match(result.sqlTestNote, /cloud autorisée/);
  assert.match(role('db-engineer'), /pg_get_functiondef/);
  assert.match(role('db-engineer'), /aucun replay global/);
});
test('scénario live : vrai package, fichier exact, autorisation requise et absence de preuve rejetée', (t) => {
  const file = 'supabase/tests/functions/record-b2b-payment.test.ts';
  const result = fixture(t, file, [file], { 'supabase/tests/package.json': '{"name":"@breakery/supabase-tests"}' });
  assert.equal(result.package, '@breakery/supabase-tests'); assert.deepEqual(result.tests, [file]);
  assert.equal(result.live, true); assert.match(role('test-engineer'), /autorisation explicite/);
  assert.throws(() => liveAllowed(result.package, false, {}), /autorisation/);
  assert.equal(testEvidence({ success: true, numPassedTests: 0, numPendingTests: 12 }).valid, false);
});
test('scénario release : garde-fous et manifeste, aucune suggestion de tests métier ni mutation implicite', (t) => {
  const files = ['scripts/release/preflight.test.mjs', 'scripts/release/manifest.test.mjs', 'apps/pos/src/production.test.ts'];
  const result = fixture(t, '.github/workflows/production-backoffice.yml', files);
  assert.equal(result.package, null); assert.deepEqual(new Set(result.tests), new Set(files.slice(0, 2)));
  assert.deepEqual(result.skillsSuggested, []); assert.equal(result.live, false); assert.equal(result.testCommand, null);
  assert.match(result.note, /aucun skill ni test exécuté/);
});
test('recherche vide : aucun candidat ne constitue une réussite ou une commande inventée', (t) => {
  const result = fixture(t, 'apps/pos/src/Unknown.ts', [], { 'apps/pos/package.json': '{"name":"@breakery/app-pos"}' });
  assert.deepEqual(result.tests, []); assert.equal(result.testCommand, null);
  assert.equal(testEvidence({ success: true, numPassedTests: 0 }).valid, false);
});
