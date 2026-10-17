import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createShopConfigurationBackup } from './shop-config-backup.mjs';
import { generateRecoveryKeys, restoreBackup } from './encrypted-backup.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'breakery-shop-config-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  generateRecoveryKeys(join(root, 'keys'));
  const files = ['launcher', 'registry', 'hub-buffer', 'tls-certificate', 'tls-private-key'].map((role) => {
    const path = join(root, role);
    writeFileSync(path, `synthetic ${role}`);
    return { role, path };
  });
  const targetSource = join(root, 'bundle.js');
  writeFileSync(targetSource, 'https://getctmbpjnrrjzncaqze.supabase.co');
  return { root, config: { version: 1, projectRef: 'getctmbpjnrrjzncaqze', targetSource, files },
    publicKey: readFileSync(join(root, 'keys/backup-public.pem')),
    privateKey: readFileSync(join(root, 'keys/recovery-private.pem')), output: join(root, 'shop.bkb') };
}

test('configuration synthétique chiffrée et récupérée, couverture bornée', (t) => {
  const f = fixture(t);
  const result = createShopConfigurationBackup(f.config, f.publicKey, f.output);
  assert.equal(result.coverage['terminal-outboxes'], 'missing');
  assert.equal(result.recoveryVerified, false);
  const target = join(f.root, 'restored');
  restoreBackup(f.output, f.privateKey, target, f.config.projectRef);
  for (const file of f.config.files) assert.deepEqual(readFileSync(join(target, 'shop-config', file.role)), readFileSync(file.path));
  assert.equal(readFileSync(f.output).includes(Buffer.from('synthetic tls-private-key')), false);
});

test('sélection incomplète, mauvaise cible et clé de récupération : refus sans archive', (t) => {
  const f = fixture(t);
  assert.throws(() => createShopConfigurationBackup({ ...f.config, files: f.config.files.slice(1) }, f.publicKey, f.output));
  assert.throws(() => createShopConfigurationBackup({ ...f.config, projectRef: 'yjhhhmjgsmyzyymvixot' }, f.publicKey, f.output));
  f.config.files.find((file) => file.role === 'tls-private-key').path = join(f.root, 'keys/recovery-private.pem');
  assert.throws(() => createShopConfigurationBackup(f.config, f.publicKey, f.output), /Recovery private key/);
  assert.equal(existsSync(f.output), false);
});
