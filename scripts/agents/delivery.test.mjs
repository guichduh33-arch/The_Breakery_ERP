import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deliveryPolicy } from './delivery-policy.mjs';
import { snapshot } from './delivery-snapshot.mjs';
import { evaluateDelivery, validateCheck, readEvidenceFile } from './delivery-evidence.mjs';
import { githubEvidence } from './delivery-github.mjs';
import { parseArgs } from './pipeline.mjs';
import { writeDeliveryReport } from './delivery-output.mjs';
import { classify } from '../ci/db-gate.mjs';

const sha = 'a'.repeat(40);
const baseSha = 'b'.repeat(40);
const date = new Date().toISOString();
const record = (id, target = 'scope') => ({ id, status: 'passed', actor: 'tester', reference: 'chat:objective-request', observedAt: date, target });
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'breakery-delivery-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const report = (name, content) => {
    const bytes = Buffer.from(typeof content === 'string' ? content : JSON.stringify(content));
    writeFileSync(join(root, name), bytes);
    return { report: name, reportSha256: createHash('sha256').update(bytes).digest('hex'), exitCode: 0, command: 'node test' };
  };
  return { root, report };
}

test('routage partagé : BO et POS, spécialistes fixes ; documentaire sans suite applicative inventée', () => {
  const policy = deliveryPolicy(['packages/domain/src/order.ts']);
  assert.equal(policy.surfaces.backoffice, true);
  assert.equal(policy.surfaces.pos, true);
  assert.ok(policy.roles.includes('test-engineer'));
  assert.ok(policy.checks.some((check) => check.id === 'bo-suite'));
  assert.ok(policy.checks.some((check) => check.id === 'pos-suite'));
  assert.equal(deliveryPolicy(['docs/runbooks/example.md']).checks.some((check) => check.id === 'targeted-tests'), false);
  assert.equal(deliveryPolicy(['supabase/functions/payment/index.ts']).surfaces.database, true);
  assert.deepEqual(deliveryPolicy(['apps/pos/.env.local']).sensitivePaths, ['apps/pos/.env.local']);
  assert.equal(policy.checks.find((check) => check.id === 'scope').role, 'primary');
  assert.equal(policy.checks.some((check) => check.role === 'owner'), false);
});

test('snapshot : renommages vus sur les deux chemins, non suivis inclus et base rattachée', () => {
  const runGit = (args) => {
    if (args[0] === 'rev-parse') return args.includes('HEAD') ? sha : baseSha;
    if (args[0] === 'merge-base') return baseSha;
    if (args[0] === 'diff') return args.includes('HEAD') ? 'apps/pos/src/local.ts\0' : 'apps/pos/src/old.ts\0apps/backoffice/src/new.ts\0';
    if (args[0] === 'ls-files') return 'scripts/agents/new.test.mjs\0';
    if (args[0] === 'status') return '?? scripts/agents/new.test.mjs';
    return 'branch';
  };
  const current = snapshot('fixture', 'origin/master', runGit);
  assert.equal(current.dirty, true);
  assert.equal(current.files.length, 4);
  assert.equal(current.policy.surfaces.backoffice, true);
  assert.notEqual(current.fingerprint, snapshot('fixture', 'other', (args) => args[0] === 'rev-parse' && !args.includes('HEAD') ? 'c'.repeat(40) : runGit(args)).fingerprint);
  assert.notEqual(current.fingerprint, snapshot('fixture', 'origin/master', runGit, 'dev').fingerprint);
  assert.throws(() => snapshot('fixture', '--option', runGit), /invalide/);
});

test('étapes : preuve absente, checkout sale, base modifiée et doublons bloquent', () => {
  const current = { sourceSha: sha, fingerprint: 'fingerprint', dirty: false, policy: deliveryPolicy([]) };
  const evidence = { schemaVersion: 1, fingerprint: current.fingerprint, checks: [record('scope')] };
  assert.equal(evaluateDelivery(current, evidence, 'scoped', '.').valid, true);
  assert.equal(evaluateDelivery({ ...current, dirty: true }, evidence, 'scoped', '.').valid, false);
  assert.equal(evaluateDelivery(current, { ...evidence, fingerprint: 'old' }, 'scoped', '.').valid, false);
  assert.equal(evaluateDelivery(current, { ...evidence, checks: [] }, 'scoped', '.').valid, false);
  assert.equal(evaluateDelivery(current, { ...evidence, checks: {} }, 'scoped', '.').valid, false);
  assert.equal(evaluateDelivery(current, { ...evidence, checks: [record('scope'), record('scope')] }, 'scoped', '.').valid, false);
  assert.throws(() => evaluateDelivery(current, evidence, 'fake', '.'), /inconnue/);
  assert.equal(evaluateDelivery(current, evidence, 'reviewed', '.').valid, false);
});

test('Vitest : tous ignorés, altération, faux succès, absence de rapport refusés ; exclusions expliquées', (t) => {
  const { root, report } = fixture(t);
  const check = { id: 'bo-suite', kind: 'vitest', target: 'local' };
  const proof = { ...record(check.id, 'local'), ...report('vitest.json', { success: true, numPassedTests: 2, numFailedTests: 0, numPendingTests: 1 }) };
  assert.match(validateCheck(check, proof, root), /ignorés/);
  assert.equal(validateCheck(check, { ...proof, skipReason: 'Scénario matériel hors de cette suite.' }, root), null);
  assert.match(validateCheck(check, { ...proof, exitCode: 1 }, root), /sortie/);
  assert.match(validateCheck(check, { ...proof, reportSha256: '0'.repeat(64) }, root), /empreinte/);
  const empty = { ...record(check.id, 'local'), ...report('empty.json', { success: true, numPassedTests: 0, numPendingTests: 8 }) };
  assert.match(validateCheck(check, empty, root), /aucun test/);
  assert.match(validateCheck(check, { ...proof, report: 'missing.json' }, root), /absent/);
  assert.throws(() => readEvidenceFile(root, '../outside'), /interne/);
});

test('Node TAP : assertions réellement exécutées, échec masqué et zéro test refusés', (t) => {
  const { root, report } = fixture(t);
  const check = { id: 'tooling-tests', kind: 'node-tap', target: 'local' };
  const proof = (name, text) => ({ ...record(check.id, 'local'), ...report(name, text) });
  assert.equal(validateCheck(check, proof('ok.tap', '# tests 2\n# pass 2\n# fail 0\n'), root), null);
  assert.match(validateCheck(check, proof('zero.tap', '# tests 0\n# pass 0\n# fail 0\n'), root), /sans réussite/);
  assert.match(validateCheck(check, proof('fail.tap', 'not ok 1\n# pass 2\n# fail 0\n'), root), /échec/);
});

test('attestations : cible, identité environnement, date et nombre SQL requis', () => {
  const check = { id: 'database-tests', kind: 'attestation', target: 'dev' };
  const proof = { ...record(check.id, 'dev'), targetFingerprint: 'dev-schema-observed', passed: 5, failed: 0 };
  assert.equal(validateCheck(check, proof, '.'), null);
  assert.match(validateCheck(check, { ...proof, passed: 0 }, '.'), /SQL/);
  assert.match(validateCheck(check, { ...proof, target: 'production' }, '.'), /Cible/);
  assert.match(validateCheck(check, { ...proof, observedAt: 'invalid' }, '.'), /Date/);
  assert.match(validateCheck(check, { ...proof, targetFingerprint: '' }, '.'), /Identité/);
});

test('GitHub : lien seul refusé, ancien run refusé, jobs ignorés refusés ; lectures paginées', async () => {
  const current = { sourceSha: sha };
  const records = [{ ...record('ci', 'ci'), runId: 12 }];
  const get = async (path) => path.includes('/runs?')
    ? { workflow_runs: [{ id: 12, head_sha: sha, event: 'push', status: 'completed', conclusion: 'success' }] }
    : { jobs: ['governance-guards', 'lint-typecheck-test-build'].map((name) => ({ name, status: 'completed', conclusion: 'success' })) };
  assert.equal((await githubEvidence(current, records, get)).get('ci'), null);
  assert.match((await githubEvidence(current, records, null)).get('ci'), /authentifiée/);
  assert.match((await githubEvidence(current, [{ ...records[0], runId: 11 }], get)).get('ci'), /différente/);
  assert.match((await githubEvidence(current, records, async (path) => path.includes('/runs?') ? get(path) : { jobs: [] })).get('ci'), /Job/);
  assert.match(validateCheck({ id: 'ci', kind: 'github', target: 'ci' }, records[0], '.'), /non authentifiée/);
  assert.equal(validateCheck({ id: 'ci', kind: 'github', target: 'ci' }, records[0], '.', Date.now(), new Map([['ci', null]])), null);
});

test('CLI : options inconnues, doublons, sorties hors preuves et étapes sans preuves refusés', () => {
  assert.deepEqual(parseArgs([]), { mode: 'inspect', base: 'origin/master', target: 'production' });
  assert.throws(() => parseArgs(['inspect', '--base', 'a', '--base', 'b']), /dupliquée/);
  assert.throws(() => parseArgs(['check', '--stage', 'ready']), /requis/);
  assert.throws(() => parseArgs(['inspect', '--output', 'docs/report.json']), /réservée/);
  assert.throws(() => parseArgs(['inspect', '--stage', 'ready']), /aucune preuve/);
  assert.throws(() => parseArgs(['inspect', '--target', 'unknown']), /inconnue/);
});

test('mandat dev ou sans livraison : aucune preuve production imposée, tests applicatifs conservés', () => {
  const files = ['apps/backoffice/src/Page.tsx'];
  for (const target of ['dev', 'none']) {
    const policy = deliveryPolicy(files, target);
    assert.equal(policy.checks.find((check) => check.id === 'bo-suite').allowNotApplicable, undefined);
    for (const id of ['release', 'deployment', 'acceptance']) {
      const check = policy.checks.find((item) => item.id === id);
      assert.notEqual(check.target, 'production');
      const proof = target === 'dev' ? { ...record(id, 'dev'), targetFingerprint: 'dev-artifact' }
        : { ...record(id, 'scope'), status: 'not-applicable', reason: 'Demande sans livraison applicative.' };
      assert.equal(validateCheck(check, proof, '.'), null);
      assert.match(validateCheck(check, { ...proof, target: 'production' }, '.'), /Cible/);
    }
  }
});

test('après intégration : base égale à HEAD ne retire pas les preuves requises par un contrôle vide', () => {
  const current = { sourceSha: sha, fingerprint: 'new', dirty: false, files: [], policy: deliveryPolicy([]) };
  const evidence = { schemaVersion: 1, fingerprint: 'new', checks: [record('scope')] };
  const result = evaluateDelivery(current, evidence, 'integrated', '.');
  assert.equal(result.valid, false);
  assert.ok(result.blockers.some((blocker) => blocker.includes('Périmètre vide')));
});

test('routage DB aligné sur le vrai classificateur CI, y compris son propre filet', () => {
  const paths = ['.github/workflows/pgtap-pr.yml', 'scripts/ci/db-gate.mjs', 'scripts/ci/db-gate.test.mjs',
    'supabase/functions/payment/index.ts', 'supabase/tests/permission.test.sql', 'supabase/migrations/new.sql', 'apps/pos/src/Cart.tsx'];
  for (const path of paths) {
    const ci = classify({ eventName: 'pull_request', event: { pull_request: { base: { sha: baseSha }, head: { sha } } },
      readDiff: () => `M\0${path}\0` });
    assert.equal(deliveryPolicy([path]).surfaces.database, ci.applicable, path);
  }
});

test('lot documentaire : non-applicabilité justifiée, sans installation fictive ; impossible de contourner une preuve applicative', () => {
  const docs = deliveryPolicy(['docs/runbooks/example.md']);
  for (const id of ['release', 'deployment', 'acceptance']) {
    const check = docs.checks.find((item) => item.id === id);
    const proof = { ...record(id, 'production'), status: 'not-applicable', reason: 'Documentation seulement ; aucune surface applicative livrée.' };
    assert.equal(validateCheck(check, proof, '.'), null);
    assert.match(validateCheck(check, { ...proof, reason: '' }, '.'), /justification/);
    const posCheck = deliveryPolicy(['apps/pos/src/Cart.tsx']).checks.find((item) => item.id === id);
    assert.match(validateCheck(posCheck, proof, '.'), /interdite/);
  }
  const bo = deliveryPolicy(['apps/backoffice/src/Page.tsx']).checks.find((item) => item.id === 'bo-suite');
  assert.match(validateCheck(bo, { ...record('bo-suite', 'local'), status: 'not-applicable', reason: 'skip' }, '.'), /interdite/);
});

test('sorties : traversée refusée, fichier conservé et aucun écrasement', (t) => {
  const { root } = fixture(t);
  assert.throws(() => writeDeliveryReport(root, '.release-manifests/delivery/../../docs/proof.json', {}), /interne/);
  writeDeliveryReport(root, '.release-manifests/delivery/test.json', { proof: 1 });
  assert.throws(() => writeDeliveryReport(root, '.release-manifests/delivery/test.json', { proof: 2 }), /EEXIST/);
});
