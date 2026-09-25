import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { contextFor, routeSkills } from './context.mjs';
import { syncMirrors, roleToToml } from './sync.mjs';
import { liveAllowed, testEvidence } from './test.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'breakery-agents-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (name, text) => { const path = join(root, name); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
  put('AGENTS.md', '# AGENTS.md\nCo-author Codex si assisté.\n');
  put('.agents/skills/orders/SKILL.md', '# Orders\nAGENTS.md\n');
  put('.claude/skills/orders/SKILL.md', 'ancienne copie');
  put('.claude/skills/playwright-cli/SKILL.md', 'fourni par outil');
  put('.agents/skills/playwright-cli/SKILL.md', 'autre copie outil');
  put('.claude/agents/test-engineer.md', '---\nname: test-engineer\ndescription: "Tests CLAUDE.md"\nmodel: sonnet\n---\nLire CLAUDE.md.\n');
  return { root, put };
}
test('miroirs : dérive détectée, génération idempotente, copies fournisseur intactes', (t) => {
  const { root, put } = fixture(t);
  assert.ok(syncMirrors(root).changed.length > 0);
  syncMirrors(root, true);
  assert.deepEqual(syncMirrors(root).changed, []);
  assert.deepEqual(syncMirrors(root, true).changed, []);
  assert.equal(readFileSync(join(root, '.claude/skills/playwright-cli/SKILL.md'), 'utf8'), 'fourni par outil');
  put('.agents/skills/orders/SKILL.md', 'nouveau contrat');
  assert.deepEqual(syncMirrors(root).changed, ['.claude/skills/orders/SKILL.md']);
  put('.claude/skills/orders/extra.md', 'travail à préserver');
  assert.throws(() => syncMirrors(root, true), /sans source/);
  assert.equal(readFileSync(join(root, '.claude/skills/orders/extra.md'), 'utf8'), 'travail à préserver');
});
test('miroir : liens vers Impeccable résolus sans copie fournisseur', (t) => {
  const { root, put } = fixture(t);
  put('.agents/skills/impeccable/SKILL.md', 'outil canonique');
  put('.agents/skills/orders/references/model.md', '[méthode](../../impeccable/SKILL.md)');
  syncMirrors(root, true);
  assert.equal(readFileSync(join(root, '.claude/skills/orders/references/model.md'), 'utf8'),
    '[méthode](../../../../.agents/skills/impeccable/SKILL.md)');
  assert.equal(readFileSync(join(root, '.agents/skills/impeccable/SKILL.md'), 'utf8'), 'outil canonique');
});
test('profil TOML : texte échappé, instructions communes, aucun modèle Claude exporté', () => {
  const result = roleToToml('---\nname: tester\ndescription: "Lire CLAUDE.md"\nmodel: opus\n---\nChemin C:\\tmp ; "citation"\nCLAUDE.md\n');
  const instructions = JSON.parse(result.split('developer_instructions = ')[1]);
  assert.match(instructions, /C:\\tmp/);
  assert.match(instructions, /AGENTS.md/);
  assert.doesNotMatch(result, /model =/);
});
test('recherche BO : tests des pages et features, mapping du vrai package live', (t) => {
  const { root, put } = fixture(t);
  put('apps/backoffice/package.json', '{"name":"@breakery/app-backoffice"}');
  put('apps/backoffice/src/pages/orders/OrdersPage.tsx', '');
  const tests = ['apps/backoffice/src/pages/orders/__tests__/orders-page.test.tsx',
    'apps/backoffice/src/features/orders/__tests__/orders.test.tsx'];
  assert.deepEqual(contextFor('apps/backoffice/src/pages/orders/OrdersPage.tsx', root, tests).tests.sort(), tests.sort());
  put('supabase/tests/package.json', '{"name":"@breakery/supabase-tests"}');
  put('supabase/tests/functions/payment.test.ts', '');
  assert.equal(contextFor('supabase/tests/functions/payment.test.ts', root, []).package, '@breakery/supabase-tests');
  assert.equal(contextFor('supabase/tests', root, []).package, '@breakery/supabase-tests');
  assert.throws(() => contextFor('../outside', root, []), /interne/);
});
test('recherche : nouveaux tests non suivis visibles, fichiers ignorés exclus', (t) => {
  const { root, put } = fixture(t);
  execFileSync('git', ['init', '--quiet', root]);
  put('packages/demo/package.json', '{"name":"@breakery/demo"}');
  put('packages/demo/src/example.ts', '');
  put('packages/demo/src/example.test.ts', '');
  put('packages/demo/src/example-ignored.test.ts', '');
  put('.gitignore', '**/*-ignored.test.ts\n');
  assert.deepEqual(contextFor('packages/demo/src/example.ts', root).tests,
    ['packages/demo/src/example.test.ts']);
});
test('recherche : release vers ses garde-fous, migration vers les tests SQL', (t) => {
  const { root, put } = fixture(t);
  put('.github/workflows/production-backoffice.yml', '');
  put('supabase/migrations/20260925_payment.sql', '');
  const files = ['scripts/release/preflight.test.mjs',
    'apps/backoffice/src/production.test.ts', 'supabase/tests/payment.sql'];
  assert.deepEqual(contextFor('.github/workflows/production-backoffice.yml', root, files).tests,
    ['scripts/release/preflight.test.mjs']);
  assert.deepEqual(contextFor('supabase/migrations/20260925_payment.sql', root, files).tests,
    ['supabase/tests/payment.sql']);
});
test('routage : symptôme POS, migration et release ne chargent pas tous les skills', () => {
  assert.deepEqual(routeSkills('apps/pos/src/features/payment/Checkout.tsx'), ['pos-flow-audit']);
  assert.deepEqual(routeSkills('supabase/migrations/new.sql'), ['db-migrations']);
  assert.deepEqual(routeSkills('.github/workflows/production-backoffice.yml'), []);
});
test('preuve : aucun test, tous ignorés, échec et succès partiel sont distingués', () => {
  assert.equal(testEvidence({ success: true, numPassedTests: 0 }).valid, false);
  assert.equal(testEvidence({ success: true, numPendingTests: 4 }).valid, false);
  assert.equal(testEvidence({ success: false, numPassedTests: 4, numFailedTests: 1 }).valid, false);
  assert.deepEqual(testEvidence({ success: true, numPassedTests: 2, numPendingTests: 1 }),
    { passed: 2, failed: 0, skipped: 1, valid: true });
});
test('live : consentement et cible dev exigés avant exécution', () => {
  assert.throws(() => liveAllowed('@breakery/supabase-tests', false, {}), /autorisation/);
  assert.throws(() => liveAllowed('@breakery/supabase-tests', true,
    { VITE_SUPABASE_URL: 'https://production.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fake' }), /cible dev/);
  assert.doesNotThrow(() => liveAllowed('@breakery/supabase-tests', true,
    { VITE_SUPABASE_URL: 'https://ikcyvlovptebroadgtvd.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fake' }));
});
