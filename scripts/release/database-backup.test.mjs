import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { prepareDatabaseBackup, exportDatabaseBackup } from './database-backup.mjs';
import { generateRecoveryKeys, restoreBackup } from './encrypted-backup.mjs';
import { syntheticListing } from './backup-fixture.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'breakery-db-preparation-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const tool = join(root, 'fake-tool');
  writeFileSync(tool, 'synthetic-native-tool');
  const config = { version: 1, projectRef: 'getctmbpjnrrjzncaqze',
    host: 'db.getctmbpjnrrjzncaqze.supabase.co', port: 5432, database: 'postgres', user: 'postgres',
    passwordFile: join(root, 'pgpass'), rootCertificate: join(root, 'root.crt'),
    pgDump: { path: tool, sha256: createHash('sha256').update(readFileSync(tool)).digest('hex') } };
  config.pgRestore = { ...config.pgDump };
  writeFileSync(config.passwordFile, 'synthetic-password-not-for-a-server');
  writeFileSync(config.rootCertificate, 'synthetic-ca');
  return { root, config, output: join(root, 'database.bkb') };
}

test('préparation sans connexion, cible exacte et limites explicites', async (t) => {
  const f = fixture(t);
  const plan = await exportDatabaseBackup(f.config, null, f.output);
  assert.equal(plan.applicationRecoveryVerified, false);
  assert.equal(plan.automationInstalled, false);
  assert.equal(existsSync(f.output), false);
  assert.throws(() => prepareDatabaseBackup({ ...f.config, host: 'unexpected.example.com' }));
  assert.throws(() => prepareDatabaseBackup({ ...f.config, user: 'postgres --injection' }));
});

test('dump synthétique : chiffrement sans fichier clair, restitution exacte et preuve limitée', async (t) => {
  const f = fixture(t);
  generateRecoveryKeys(join(f.root, 'keys'));
  const dump = Buffer.from('PGDMP synthetic fixture only');
  const calls = [];
  const capture = async (executable, args, env, input) => {
    calls.push(args);
    assert.equal(env.PGHOST, f.config.host);
    assert.equal(env.PGSSLMODE, 'verify-full');
    assert.match(env.PGOPTIONS, /default_transaction_read_only=on/);
    assert.equal(env.PGPASSWORD, undefined);
    if (args.includes('--list')) { assert.deepEqual(input, dump); return syntheticListing; }
    return dump;
  };
  const result = await exportDatabaseBackup(f.config, readFileSync(join(f.root, 'keys/backup-public.pem')),
    f.output, { execute: true, capture });
  assert.equal(result.recoveryVerified, false);
  assert.equal(calls.length, 2);
  const target = join(f.root, 'restored');
  restoreBackup(f.output, readFileSync(join(f.root, 'keys/recovery-private.pem')), target, f.config.projectRef);
  assert.deepEqual(readFileSync(join(target, 'database/database.dump')), dump);
  assert.equal(readFileSync(f.output).includes(dump), false);
  assert.equal(JSON.parse(readFileSync(join(target, 'database/export-evidence.json'))).applicationRecoveryVerified, false);
});

test('échec natif ou format invalide : aucune archive créée', async (t) => {
  const f = fixture(t);
  await assert.rejects(exportDatabaseBackup(f.config, null, f.output, { execute: true,
    capture: async () => { throw new Error('synthetic native failure'); } }));
  await assert.rejects(exportDatabaseBackup(f.config, null, f.output, { execute: true,
    capture: async () => Buffer.from('not a dump') }));
  assert.equal(existsSync(f.output), false);
});

test('pooler IPv4 de session : projet lié au login, jamais le pooler transactionnel', async (t) => {
  const f = fixture(t);
  const config = { ...f.config, connectionMode: 'session',
    host: 'aws-0-ap-southeast-1.pooler.supabase.com', user: `postgres.${f.config.projectRef}`, temporaryAccess: true };
  assert.equal(prepareDatabaseBackup(config).connectionMode, 'session');
  assert.throws(() => prepareDatabaseBackup({ ...config, user: 'postgres.yjhhhmjgsmyzyymvixot' }));
  assert.throws(() => prepareDatabaseBackup({ ...config, port: 6543 }));
  assert.throws(() => prepareDatabaseBackup({ ...config, connectionMode: 'transaction' }));
  let calls = 0;
  await assert.rejects(exportDatabaseBackup(config, null, f.output, { execute: true, capture: async (_exe, _args, env) => {
    calls++;
    assert.equal(env.PGUSER, `postgres.${f.config.projectRef}`);
    assert.match(env.PGOPTIONS, /default_transaction_read_only=on.*jit=true/);
    throw new Error('synthetic stop before dump');
  } }));
  assert.equal(calls, 1);
  assert.equal(existsSync(f.output), false);
});
