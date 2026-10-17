import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createBackup, createMemoryBackup, generateRecoveryKeys, restoreBackup, retentionReview } from './encrypted-backup.mjs';

const project = 'c'.repeat(20);
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'breakery-backup-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'source');
  mkdirSync(source);
  writeFileSync(join(source, 'config.env'), 'SYNTHETIC_SECRET=fictional-test-value');
  writeFileSync(join(source, 'binary'), Buffer.from([0, 255, 128, 10]));
  generateRecoveryKeys(join(root, 'keys'));
  const publicKey = readFileSync(join(root, 'keys/backup-public.pem'));
  const privateKey = readFileSync(join(root, 'keys/recovery-private.pem'));
  const config = { version: 1, projectRef: project, retentionDays: 30,
    coverage: { database: 'missing', storage: 'missing', 'shop-config': 'provided',
      bundles: 'missing', 'terminal-outboxes': 'missing' },
    sources: [{ name: 'shop', area: 'shop-config', path: source }] };
  return { root, source, config, publicKey, privateKey, archive: join(root, 'snapshot.bkb') };
}

test('chiffrement public : récupération exacte, binaire et couverture partielle explicite', (t) => {
  const f = fixture(t);
  const result = createBackup(f.config, f.publicKey, f.archive);
  assert.equal(result.files, 2);
  assert.equal(result.cloudCopyVerified, false);
  assert.equal(result.coverage.database, 'missing');
  assert.equal(readFileSync(f.archive).includes(Buffer.from('fictional-test-value')), false);
  const recovered = join(f.root, 'restored');
  assert.equal(restoreBackup(f.archive, f.privateKey, recovered, project).files, 2);
  for (const name of ['binary', 'config.env']) {
    assert.deepEqual(readFileSync(join(recovered, 'shop', name)), readFileSync(join(f.source, name)));
  }
  assert.throws(() => restoreBackup(f.archive, f.privateKey, recovered, project), /must not exist/);
  assert.throws(() => createBackup(f.config, f.publicKey, f.archive), /already exists/);
});

test('archive altérée ou tronquée : aucune extraction', (t) => {
  const f = fixture(t);
  createBackup(f.config, f.publicKey, f.archive);
  const original = readFileSync(f.archive);
  const modified = Buffer.from(original);
  modified[modified.length - 20] ^= 1;
  for (const [name, data] of [['tampered', modified], ['truncated', original.subarray(0, 30)]]) {
    const input = join(f.root, `${name}.bkb`);
    const output = join(f.root, name);
    writeFileSync(input, data);
    assert.throws(() => restoreBackup(input, f.privateKey, output, project));
    assert.equal(existsSync(output), false);
  }
});

test('un fichier de plusieurs mégaoctets se récupère sans débordement de pile', (t) => {
  const f = fixture(t);
  const large = Buffer.alloc(4 * 1024 * 1024, 0xad);
  writeFileSync(join(f.source, 'large-database.dump'), large);
  createBackup(f.config, f.publicKey, f.archive);
  const output = join(f.root, 'restored-large');
  assert.equal(restoreBackup(f.archive, f.privateKey, output, project).files, 3);
  assert.deepEqual(readFileSync(join(output, 'shop/large-database.dump')), large);
});

test('un encodage base64 non canonique reste refusé avant extraction', (t) => {
  const f = fixture(t);
  for (const [index, data] of ['YQ', 'Y Q==', 'YQ===', 'YQ==\n', 'YR=='].entries()) {
    const input = join(f.root, `noncanonical-${index}.bkb`);
    const output = join(f.root, `noncanonical-${index}`);
    createMemoryBackup({ projectRef: project, coverage: f.config.coverage,
      files: [{ path: 'shop/value', data,
        sha256: createHash('sha256').update(Buffer.from(data, 'base64')).digest('hex') }] }, f.publicKey, input);
    assert.throws(() => restoreBackup(input, f.privateKey, output, project), /Invalid encoded file/);
    assert.equal(existsSync(output), false);
  }
});

test('mauvaise clé et mauvaise cible : aucune extraction', (t) => {
  const f = fixture(t);
  createBackup(f.config, f.publicKey, f.archive);
  generateRecoveryKeys(join(f.root, 'other-keys'));
  const otherKey = readFileSync(join(f.root, 'other-keys/recovery-private.pem'));
  const output = join(f.root, 'restored');
  assert.throws(() => restoreBackup(f.archive, otherKey, output, project));
  assert.throws(() => restoreBackup(f.archive, f.privateKey, output, 'd'.repeat(20)), /target mismatch/);
  assert.equal(existsSync(output), false);
});

test('sources : refus des noms ambigus Windows, couverture vide et sortie dans la source', (t) => {
  const f = fixture(t);
  assert.throws(() => createBackup(f.config, f.publicKey, join(f.source, 'backup.bkb')), /inside a source/);
  f.config.coverage.database = 'provided';
  assert.throws(() => createBackup(f.config, f.publicKey, f.archive), /requires a source/);
  f.config.coverage.database = 'missing';
  f.config.sources[0].name = '../escape';
  assert.throws(() => createBackup(f.config, f.publicKey, f.archive), /Invalid source/);
});

test('la clé privée de récupération ne peut pas entrer dans la sauvegarde', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.source, 'recovery.pem'), f.privateKey);
  assert.throws(() => createBackup(f.config, f.publicKey, f.archive), /Recovery private key/);
  assert.equal(existsSync(f.archive), false);
});

test('une jonction de source est refusée, sans suivre les fichiers externes', (t) => {
  const f = fixture(t);
  const external = join(f.root, 'external');
  mkdirSync(external);
  writeFileSync(join(external, 'private'), 'outside');
  symlinkSync(external, join(f.source, 'linked'), 'junction');
  assert.throws(() => createBackup(f.config, f.publicKey, f.archive), /Symbolic links/);
  assert.equal(existsSync(f.archive), false);
});

test('rétention : trente jours ne déclenchent jamais une suppression', () => {
  const result = retentionReview([{ id: 'old', createdAt: '2026-09-01T00:00:00Z' },
    { id: 'recent', createdAt: '2026-10-16T00:00:00Z' }], new Date('2026-10-17T00:00:00Z'));
  assert.equal(result[0].olderThan30Days, true);
  assert.equal(result[1].olderThan30Days, false);
  assert.ok(result.every((entry) => !entry.deletionAuthorized));
});
