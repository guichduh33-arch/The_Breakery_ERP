import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BANK_FILES, BANK_RELEASE, BANK_SQL_TEST_SHA, BANK_SQL_TEST_COUNT, BANK_SQL_FIXTURE_FILES,
  inspectBankSource, inspectBankTestSource, inspectIntegratedRelease } from './selective-bank.mjs';

const controllerSha = 'a'.repeat(40);
function fixture({ paths = BANK_FILES, testPaths = BANK_SQL_FIXTURE_FILES, changedContract = false, ancestor = true,
  mode = '100644', missingSuite = false, status = 'M' } = {}) {
  return (args) => {
    if (args[0] === 'merge-base') {
      if (!ancestor) throw new Error('not ancestor');
      return Buffer.alloc(0);
    }
    if (args[0] === 'diff') return Buffer.from((args[3] === BANK_RELEASE.candidate ? testPaths : paths)
      .map((p) => `${status}\t${p}`).join('\n') + '\n');
    if (args[0] === 'ls-tree') {
      const roots = BANK_SQL_FIXTURE_FILES.filter((p) => /^supabase\/tests\/[^/]+\.test\.sql$/.test(p)).length;
      const tree = [...BANK_SQL_FIXTURE_FILES, ...Array.from({ length: BANK_SQL_TEST_COUNT - roots - Number(missingSuite) },
        (_, i) => `supabase/tests/unchanged_${i}.test.sql`)];
      return Buffer.from(tree.map((p) => `${mode} blob ${'b'.repeat(40)}\t${p}`).join('\n') + '\n');
    }
    if (args[0] === 'show') return Buffer.from(changedContract && args[1].startsWith(controllerSha) ? 'changed' : 'bytes\n');
    throw new Error('unexpected git command');
  };
}
test('sélectif : identité exacte, empreintes brutes et schémas distincts', () => {
  const result = inspectBankSource({ controllerSha, git: fixture() });
  assert.equal(result.files.length, 8);
  assert.equal(result.candidate, BANK_RELEASE.candidate);
  assert.notEqual(result.production, result.rehearsal);
  assert.ok(result.files.every((f) => /^[a-f0-9]{64}$/.test(f.sha256)));
  assert.equal(result.scope, 'bank-only-source-identity');
  assert.equal(result.testSource.sourceSha, BANK_SQL_TEST_SHA);
  assert.equal(result.testSource.applicationSourceSha, BANK_RELEASE.candidate);
  assert.notEqual(result.testSource.sourceSha, result.candidate);
  assert.equal(result.testSource.files.length, 156);
  assert.equal(result.testSource.suiteFiles, BANK_SQL_TEST_COUNT);
});

test('sources SQL : refuser tout écart hors allowlist, suppression, lien ou suite manquante', () => {
  for (const testPaths of [[...BANK_SQL_FIXTURE_FILES, 'apps/backoffice/src/changed.ts'], BANK_SQL_FIXTURE_FILES.slice(1),
    [...BANK_SQL_FIXTURE_FILES.slice(1), BANK_SQL_FIXTURE_FILES[1]]]) {
    assert.throws(() => inspectBankTestSource({ git: fixture({ testPaths }) }), /fixtures autorisées/);
  }
  assert.throws(() => inspectBankTestSource({ git: fixture({ status: 'D' }) }), /fixtures autorisées/);
  assert.throws(() => inspectBankTestSource({ git: fixture({ mode: '120000' }) }), /irrégulier/);
  assert.throws(() => inspectBankTestSource({ git: fixture({ missingSuite: true }) }), /incomplet/);
});
test('sélectif : fichier supplémentaire, manquant, doublon ou contrat différent refusés', () => {
  for (const paths of [[...BANK_FILES, 'apps/pos/src/cash.ts'], BANK_FILES.slice(1), [...BANK_FILES.slice(1), BANK_FILES[1]]]) {
    assert.throws(() => inspectBankSource({ controllerSha, git: fixture({ paths }) }), /huit fichiers/);
  }
  assert.throws(() => inspectBankSource({ controllerSha, git: fixture({ changedContract: true }) }), /Contrat bancaire/);
  assert.throws(() => inspectBankSource({ controllerSha, git: fixture({ ancestor: false }) }), /ancestor/);
  assert.throws(() => inspectBankSource({ controllerSha: '--help', git: fixture() }), /SHA/);
});
test('sélectif : une identité de source ne dispense pas du gate complet master', async () => {
  await assert.rejects(inspectIntegratedRelease({ controllerSha, git: fixture(),
    get: async () => ({ commit: { sha: BANK_RELEASE.candidate } }),
  }), /tête actuelle/);
});
