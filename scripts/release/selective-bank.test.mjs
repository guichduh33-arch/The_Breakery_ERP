import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BANK_FILES, BANK_RELEASE, inspectBankSource, inspectIntegratedRelease } from './selective-bank.mjs';

const controllerSha = 'a'.repeat(40);
function fixture({ paths = BANK_FILES, changedContract = false, ancestor = true } = {}) {
  return (args) => {
    if (args[0] === 'merge-base') {
      if (!ancestor) throw new Error('not ancestor');
      return Buffer.alloc(0);
    }
    if (args[0] === 'diff') return Buffer.from(paths.map((p) => `M\t${p}`).join('\n') + '\n');
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
