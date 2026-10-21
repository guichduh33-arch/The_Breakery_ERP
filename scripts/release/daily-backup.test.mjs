import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateRecoveryKeys, restoreBackup } from './encrypted-backup.mjs';
import { runDailyBackup } from './daily-backup.mjs';
import { databaseFixture, syntheticCapture, syntheticDump, syntheticListing } from './backup-fixture.mjs';

test('lanceur quotidien : DB neuve et composants récupérables, reçu sans secret et refus de remplacement', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'breakery-daily-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  generateRecoveryKeys(join(root, 'recovery'));
  const outputDirectory = join(root, 'output');
  mkdirSync(outputDirectory);
  const source = join(root, 'fixture');
  writeFileSync(source, 'SYNTHETIC_PRIVATE_TEST_DATA');
  const configPath = join(root, 'config.json');
  writeFileSync(configPath, JSON.stringify({ version: 1, projectRef: 'c'.repeat(20), retentionDays: 30,
    database: databaseFixture(root, 'c'.repeat(20)),
    coverage: { database: 'provided', storage: 'missing', 'shop-config': 'provided', bundles: 'missing', 'terminal-outboxes': 'missing' },
    sources: [{ name: 'settings', area: 'shop-config', path: source }] }));
  const options = { configPath, publicKeyPath: join(root, 'recovery/backup-public.pem'),
    outputDirectory, now: new Date('2026-10-17T00:00:00Z') };
  let exports = 0;
  const capture = async (...args) => { if (!args[1].includes('--list')) exports++; return syntheticCapture(...args); };
  const receipt = await runDailyBackup(options, { capture });
  assert.equal(receipt.status, 'local-encrypted-only');
  assert.equal(receipt.cloudCopyVerified, false);
  assert.doesNotMatch(JSON.stringify(receipt), /SYNTHETIC_PRIVATE_TEST_DATA|SYNTHETIC_PASSWORD|pgpass|root.crt/);
  await assert.rejects(runDailyBackup(options), /exists/);
  const result = restoreBackup(join(outputDirectory, receipt.archive),
    readFileSync(join(root, 'recovery/recovery-private.pem')), join(root, 'restore'), 'c'.repeat(20));
  assert.equal(result.files, 4);
  assert.deepEqual(readFileSync(join(root, 'restore/database/database.dump')), syntheticDump);
  const manifest = JSON.parse(readFileSync(join(root, 'restore/daily/capture-manifest.json')));
  assert.equal(manifest.components[0].name, 'settings');
  assert.equal(manifest.coverage.storage, 'missing');
  assert.equal(manifest.database.archiveListingVerified, true);
  assert.match(receipt.database.logicalDumpSha256, /^[a-f0-9]{64}$/);
  assert.ok(Date.parse(receipt.database.completedAt) >= Date.parse(receipt.database.startedAt));
  assert.equal(readFileSync(join(root, 'restore/settings/snapshot'), 'utf8'), 'SYNTHETIC_PRIVATE_TEST_DATA');
  await runDailyBackup({ ...options, now: new Date('2026-10-18T00:00:00Z') }, { capture });
  assert.equal(exports, 2);
  const next = { ...options, now: new Date('2026-10-19T00:00:00Z') };
  const original = JSON.parse(readFileSync(configPath));
  for (const database of [undefined, { ...original.database, projectRef: 'd'.repeat(20) },
    { ...original.database, host: 'wrong.example' }]) {
    writeFileSync(configPath, JSON.stringify({ ...original, database }));
    await assert.rejects(runDailyBackup(next, { capture }));
  }
  writeFileSync(configPath, JSON.stringify(original));
  writeFileSync(configPath, JSON.stringify({ ...original, sources: [...original.sources,
    { name: 'old-db', area: 'database', path: source }] }));
  await assert.rejects(runDailyBackup(next, { capture }), /Invalid source/);
  writeFileSync(configPath, JSON.stringify(original));
  for (const badCapture of [async () => Buffer.from('invalid'), async (_exe, args) =>
    args.includes('--list') ? Buffer.alloc(0) : syntheticDump, async () => { throw new Error('SYNTHETIC_SECRET'); }]) {
    await assert.rejects(runDailyBackup(next, { capture: badCapture }), (error) => !error.message.includes('SYNTHETIC_SECRET'));
  }
  assert.equal(readdirSync(outputDirectory).some((name) => name.includes('2026-10-19')), false);
  const databaseOnly = { ...original, sources: [], coverage: { ...original.coverage, 'shop-config': 'missing' } };
  writeFileSync(configPath, JSON.stringify(databaseOnly));
  const onlyDb = await runDailyBackup(next, { capture });
  assert.deepEqual(onlyDb.components, []);
  assert.equal(onlyDb.coverage['shop-config'], 'missing');
  assert.equal(onlyDb.files, 3);
  assert.ok(syntheticListing.length);
});
