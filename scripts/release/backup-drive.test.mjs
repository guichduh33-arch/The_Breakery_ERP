import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareDriveCopy, publishBackup, runRclone } from './backup-drive.mjs';
import { runDailyBackup, runDailyBackupWithDrive } from './daily-backup.mjs';
import { generateRecoveryKeys } from './encrypted-backup.mjs';

const folderId = '1WWBmF8xG5muXnfdIBnWfpaaMspfzMFUN';
const digest = (data) => createHash('sha256').update(data).digest('hex');
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'breakery-drive-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  generateRecoveryKeys(join(root, 'keys'));
  mkdirSync(join(root, 'output'));
  writeFileSync(join(root, 'fixture'), 'SYNTHETIC_DATA_ONLY');
  const configPath = join(root, 'backup.json');
  writeFileSync(configPath, JSON.stringify({ version: 1, projectRef: 'c'.repeat(20), retentionDays: 30,
    coverage: { database: 'missing', storage: 'missing', 'shop-config': 'provided', bundles: 'missing', 'terminal-outboxes': 'missing' },
    sources: [{ name: 'settings', area: 'shop-config', path: join(root, 'fixture') }] }));
  const options = { configPath, publicKeyPath: join(root, 'keys/backup-public.pem'), outputDirectory: join(root, 'output'),
    now: new Date('2026-10-17T00:00:00Z') };
  const receipt = runDailyBackup(options);
  const receiptPath = join(root, 'output', receipt.archive.replace('.bkb', '.receipt.json'));
  const authPath = join(root, 'rclone.conf');
  writeFileSync(authPath, `[backup]\ntype = drive\nroot_folder_id = ${folderId}\ntoken = {"fixture":"NOT_A_REAL_TOKEN"}\n`);
  const executable = join(root, 'rclone-fixture.exe');
  writeFileSync(executable, 'SIMULATED_EXECUTABLE_NOT_RUN');
  const transport = { version: 1, folderId, remote: 'backup', configPath: authPath,
    executable, executableSha256: digest(readFileSync(executable)) };
  return { root, options, transport, receipt, receiptPath };
}

test('préparation seule : aucun processus et seulement le fichier chiffré ciblé', async (t) => {
  const f = fixture(t);
  const result = await publishBackup(f.receiptPath, f.transport, { run: () => assert.fail('must not execute') });
  assert.equal(result.status, 'prepared-only');
  assert.equal(result.cloudCopyVerified, false);
  const plan = prepareDriveCopy(f.receiptPath, f.transport);
  assert.equal(plan.uploadArgs[0], 'copyto');
  assert.ok(plan.uploadArgs.includes('--immutable'));
  assert.ok(plan.uploadArgs.includes('--ignore-existing'));
  assert.ok(plan.uploadArgs.includes('--checksum'));
  assert.ok(plan.remotePath.endsWith(`${f.receipt.sha256}.bkb`));
  assert.ok(plan.uploadArgs.includes(folderId));
  assert.equal(plan.uploadArgs.some((arg) => /NOT_A_REAL_TOKEN|SYNTHETIC_DATA_ONLY/.test(arg)), false);
});

test('copie puis relecture exacte : preuve distante créée après comparaison', async (t) => {
  const f = fixture(t);
  const calls = [];
  const plan = prepareDriveCopy(f.receiptPath, f.transport);
  const proof = await publishBackup(f.receiptPath, f.transport, { execute: true,
    run: async (_exe, args, bytes) => {
      calls.push(args[0]);
      return { bytes, sha256: f.receipt.sha256 };
    } });
  assert.deepEqual(calls, ['copyto', 'cat']);
  assert.equal(proof.cloudCopyVerified, true);
  assert.equal(proof.bytes, plan.bytes);
  assert.equal(proof.applicationRecoveryVerified, false);
  assert.equal(proof.retentionDeletionEnabled, false);
});

test('échec réseau puis reprise : même archive locale, aucune fausse preuve', async (t) => {
  const f = fixture(t);
  const original = readFileSync(join(f.root, 'output', f.receipt.archive));
  await assert.rejects(runDailyBackupWithDrive(f.options, f.transport, { execute: true,
    run: async () => { throw new Error('simulated network outage'); } }));
  assert.equal(readdirSync(join(f.root, 'output')).some((name) => name.includes('.drive-')), false);
  writeFileSync(join(f.root, 'fixture'), 'CHANGED_AFTER_SNAPSHOT');
  const proof = await runDailyBackupWithDrive(f.options, f.transport, { execute: true,
    run: async (_exe, _args, bytes) => ({ bytes, sha256: digest(original) }) });
  assert.equal(proof.sha256, digest(original));
  assert.deepEqual(readFileSync(join(f.root, 'output', f.receipt.archive)), original);
});

test('relecture corrompue : pas de preuve distante, archive conservée', async (t) => {
  const f = fixture(t);
  await assert.rejects(publishBackup(f.receiptPath, f.transport, { execute: true,
    run: async (_exe, _args, bytes) => ({ bytes, sha256: '0'.repeat(64) }) }));
  assert.equal(readdirSync(join(f.root, 'output')).some((name) => name.includes('.drive-')), false);
  assert.equal(digest(readFileSync(join(f.root, 'output', f.receipt.archive))), f.receipt.sha256);
});

test('mauvaise destination, exécutable altéré, alias ou archive altérée : refus avant processus', async (t) => {
  const f = fixture(t);
  const execution = { execute: true, run: () => assert.fail('must not execute') };
  await assert.rejects(publishBackup(f.receiptPath, { ...f.transport, folderId: 'other' }, execution));
  await assert.rejects(publishBackup(f.receiptPath, { ...f.transport, executableSha256: '0'.repeat(64) }, execution));
  writeFileSync(f.transport.configPath, `[backup]\ntype = alias\nroot_folder_id = ${folderId}\n`);
  await assert.rejects(publishBackup(f.receiptPath, f.transport, execution));
  writeFileSync(f.transport.configPath, `[backup]\ntype = drive\nroot_folder_id = ${folderId}\n`);
  writeFileSync(join(f.root, 'output', f.receipt.archive), 'plaintext');
  await assert.rejects(publishBackup(f.receiptPath, f.transport, execution));
});

test('runner natif : flux binaire contrôlé et stderr jamais repris dans les erreurs', async () => {
  const data = Buffer.from([0, 255, 42]);
  const result = await runRclone(process.execPath, ['-e', 'process.stdout.write(Buffer.from([0,255,42]))'], 3);
  assert.equal(result.sha256, digest(data));
  await assert.rejects(runRclone(process.execPath, ['-e', 'process.stderr.write("SYNTHETIC_SECRET");process.exit(1)']),
    (error) => !error.message.includes('SYNTHETIC_SECRET'));
  await assert.rejects(runRclone(process.execPath, ['-e', 'process.stdout.write("too large")'], 1));
});
