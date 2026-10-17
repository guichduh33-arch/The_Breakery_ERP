import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateRecoveryKeys, restoreBackup } from './encrypted-backup.mjs';
import { runDailyBackup } from './daily-backup.mjs';

test('lanceur quotidien : archive récupérable, reçu sans secret et refus de remplacement', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'breakery-daily-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  generateRecoveryKeys(join(root, 'recovery'));
  const outputDirectory = join(root, 'output');
  mkdirSync(outputDirectory);
  const source = join(root, 'fixture');
  writeFileSync(source, 'SYNTHETIC_PRIVATE_TEST_DATA');
  const configPath = join(root, 'config.json');
  writeFileSync(configPath, JSON.stringify({ version: 1, projectRef: 'c'.repeat(20), retentionDays: 30,
    coverage: { database: 'missing', storage: 'missing', 'shop-config': 'provided', bundles: 'missing', 'terminal-outboxes': 'missing' },
    sources: [{ name: 'settings', area: 'shop-config', path: source }] }));
  const options = { configPath, publicKeyPath: join(root, 'recovery/backup-public.pem'),
    outputDirectory, now: new Date('2026-10-17T00:00:00Z') };
  const receipt = runDailyBackup(options);
  assert.equal(receipt.status, 'local-encrypted-only');
  assert.equal(receipt.cloudCopyVerified, false);
  assert.doesNotMatch(JSON.stringify(receipt), /SYNTHETIC_PRIVATE_TEST_DATA/);
  assert.throws(() => runDailyBackup(options), /exists/);
  const result = restoreBackup(join(outputDirectory, receipt.archive),
    readFileSync(join(root, 'recovery/recovery-private.pem')), join(root, 'restore'), 'c'.repeat(20));
  assert.equal(result.files, 1);
  assert.equal(readFileSync(join(root, 'restore/settings/snapshot'), 'utf8'), 'SYNTHETIC_PRIVATE_TEST_DATA');
});
