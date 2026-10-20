import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareDriveCopy, publishBackup, runRclone } from './backup-drive.mjs';
import { runDailyBackup, runDailyBackupWithDrive } from './daily-backup.mjs';
import { generateRecoveryKeys } from './encrypted-backup.mjs';
import { databaseFixture, syntheticCapture } from './backup-fixture.mjs';

const folderId = '1WWBmF8xG5muXnfdIBnWfpaaMspfzMFUN';
const digest = (data) => createHash('sha256').update(data).digest('hex');
async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'breakery-drive-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  generateRecoveryKeys(join(root, 'keys'));
  mkdirSync(join(root, 'output'));
  writeFileSync(join(root, 'fixture'), 'SYNTHETIC_DATA_ONLY');
  const configPath = join(root, 'backup.json');
  writeFileSync(configPath, JSON.stringify({ version: 1, projectRef: 'c'.repeat(20), retentionDays: 30,
    database: databaseFixture(root, 'c'.repeat(20)),
    coverage: { database: 'provided', storage: 'missing', 'shop-config': 'provided', bundles: 'missing', 'terminal-outboxes': 'missing' },
    sources: [{ name: 'settings', area: 'shop-config', path: join(root, 'fixture') }] }));
  const options = { configPath, publicKeyPath: join(root, 'keys/backup-public.pem'), outputDirectory: join(root, 'output'),
    now: new Date('2026-10-17T00:00:00Z') };
  const receipt = await runDailyBackup(options, { capture: syntheticCapture });
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
  const f = await fixture(t);
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
  const f = await fixture(t);
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
  assert.equal(proof.retentionDeletionEnabled, true);
  assert.equal(proof.rotation.deleted, 0);
});

test('échec réseau puis reprise : même archive locale, aucune fausse preuve', async (t) => {
  const f = await fixture(t);
  const original = readFileSync(join(f.root, 'output', f.receipt.archive));
  await assert.rejects(runDailyBackupWithDrive(f.options, f.transport, { execute: true,
    capture: () => assert.fail('retry must not export'),
    run: async () => { throw new Error('simulated network outage'); } }));
  assert.equal(readdirSync(join(f.root, 'output')).some((name) => name.includes('.drive-')), false);
  writeFileSync(join(f.root, 'fixture'), 'CHANGED_AFTER_SNAPSHOT');
  const receiptBefore = readFileSync(f.receiptPath);
  const proof = await runDailyBackupWithDrive(f.options, f.transport, { execute: true,
    capture: () => assert.fail('retry must not export'),
    run: async (_exe, _args, bytes) => ({ bytes, sha256: digest(original) }) });
  assert.equal(proof.sha256, digest(original));
  assert.deepEqual(readFileSync(join(f.root, 'output', f.receipt.archive)), original);
  assert.deepEqual(readFileSync(f.receiptPath), receiptBefore);
  assert.equal(proof.archiveCreatedAt, f.receipt.createdAt);
});

test('relecture corrompue : pas de preuve distante, archive conservée', async (t) => {
  const f = await fixture(t);
  await assert.rejects(publishBackup(f.receiptPath, f.transport, { execute: true,
    run: async (_exe, _args, bytes) => ({ bytes, sha256: '0'.repeat(64) }) }));
  assert.equal(readdirSync(join(f.root, 'output')).some((name) => name.includes('.drive-')), false);
  assert.equal(digest(readFileSync(join(f.root, 'output', f.receipt.archive))), f.receipt.sha256);
});

test('mauvaise destination, exécutable altéré, alias ou archive altérée : refus avant processus', async (t) => {
  const f = await fixture(t);
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
  assert.deepEqual(await runRclone(process.execPath, ['-e', 'process.stdout.write("[]")'], null), []);
  await assert.rejects(runRclone(process.execPath, ['-e', 'process.stdout.write("not JSON")'], null));
});

async function historical(f, day, { verified = true, projectRef } = {}) {
  const config = JSON.parse(readFileSync(f.options.configPath));
  if (projectRef) {
    config.projectRef = projectRef;
    config.database = databaseFixture(f.root, projectRef);
  }
  const path = join(f.root, `config-${day}-${config.projectRef}.json`);
  writeFileSync(path, JSON.stringify(config));
  const now = new Date(`${day}T00:00:00Z`);
  const receipt = await runDailyBackup({ ...f.options, configPath: path, now }, { capture: syntheticCapture, clock: () => now });
  const receiptPath = join(f.options.outputDirectory, receipt.archive.replace('.bkb', '.receipt.json'));
  const plan = prepareDriveCopy(receiptPath, f.transport);
  if (verified) await publishBackup(receiptPath, f.transport, { execute: true, now,
    run: async (_exe, _args, bytes) => ({ bytes, sha256: receipt.sha256 }) });
  return { plan, receiptPath };
}
function remoteFixture(records) {
  const entries = new Map(records.map(({ plan }) => {
    const name = plan.remotePath.split('/').at(-1);
    return [name, { Name: name, Path: name, Size: plan.bytes, IsDir: false }];
  }));
  return entries;
}

test('rotation : seul lot identifié du même projet strictement au-delà de trente jours', async (t) => {
  const f = await fixture(t);
  const old = await historical(f, '2026-09-16');
  const boundary = await historical(f, '2026-09-17');
  const recent = await historical(f, '2026-10-16');
  const unknown = await historical(f, '2026-09-01', { verified: false });
  const foreign = await historical(f, '2026-09-01', { projectRef: 'd'.repeat(20) });
  const entries = remoteFixture([old, boundary, recent, unknown, foreign]);
  entries.set('unknown.bin', { Name: 'unknown.bin', Path: 'unknown.bin', Size: 4, IsDir: false });
  const calls = [];
  const proof = await publishBackup(f.receiptPath, f.transport, { execute: true, now: f.options.now,
    run: async (_exe, args, bytes) => {
      calls.push(args);
      if (args[0] === 'lsjson') return [...entries.values()];
      if (args[0] === 'deletefile') {
        assert.equal(args[1], old.plan.remotePath);
        entries.delete(args[1].split('/').at(-1));
      }
      return { bytes, sha256: f.receipt.sha256 };
    } });
  assert.equal(proof.rotation.deleted, 1);
  assert.deepEqual(calls.map((args) => args[0]), ['copyto', 'cat', 'lsjson', 'deletefile']);
  assert.equal(entries.size, 5);
  assert.ok(calls.every((args) => !['purge', 'delete', 'rmdirs', 'sync'].includes(args[0])));
  assert.ok(readFileSync(old.receiptPath).length); // Aucune suppression locale.
});

test('export/upload/readback échoué : aucune rotation ; reprise partielle sans effacer deux fois', async (t) => {
  const f = await fixture(t);
  await assert.rejects(runDailyBackupWithDrive({ ...f.options, now: new Date('2026-10-18T00:00:00Z') },
    f.transport, { execute: true, capture: async () => { throw new Error('SYNTHETIC_DB_FAILED'); },
      run: () => assert.fail('failed export must not upload, list or rotate') }));
  const first = await historical(f, '2026-09-01');
  const second = await historical(f, '2026-09-02');
  const entries = remoteFixture([first, second]);
  for (const stage of ['copyto', 'cat']) {
    const calls = [];
    await assert.rejects(publishBackup(f.receiptPath, f.transport, { execute: true, now: f.options.now,
      run: async (_exe, args, bytes) => { calls.push(args[0]);
        if (args[0] === stage) throw new Error('SYNTHETIC_TRANSFER_FAILURE');
        return { bytes, sha256: f.receipt.sha256 };
      } }));
    assert.equal(calls.includes('lsjson'), false);
    assert.equal(calls.includes('deletefile'), false);
  }
  const deletions = [];
  const runner = async (_exe, args, bytes) => {
    if (args[0] === 'lsjson') return [...entries.values()];
    if (args[0] === 'deletefile') {
      deletions.push(args[1]);
      entries.delete(args[1].split('/').at(-1));
      if (deletions.length === 2) throw new Error('SYNTHETIC_ACK_LOST_AFTER_DELETE');
    }
    return { bytes, sha256: f.receipt.sha256 };
  };
  await assert.rejects(publishBackup(f.receiptPath, f.transport, { execute: true, now: f.options.now, run: runner }));
  assert.equal(entries.size, 0);
  const result = await publishBackup(f.receiptPath, f.transport, { execute: true, now: f.options.now, run: runner });
  assert.equal(result.rotation.deleted, 2);
  assert.equal(deletions.length, 2);
  const events = readFileSync(f.receiptPath.replace('.receipt.json', '.retention-events.jsonl'), 'utf8');
  assert.match(events, /already-absent/);
  assert.doesNotMatch(events, /NOT_A_REAL_TOKEN|SYNTHETIC_PRIVATE|pgpass/);
});
