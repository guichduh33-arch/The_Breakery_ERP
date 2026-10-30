import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rehearsalEnvironment, tapVerdict, psqlFailure, requireConnectionProbe } from './rehearsal-pgtap.mjs';
import { BANK_RELEASE } from './selective-bank.mjs';

test('répétition : refuser prod, dev, utilisateur ambigu et options de connexion', () => {
  const ref = BANK_RELEASE.rehearsal;
  const good = `postgresql://postgres.${ref}:fixture@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`;
  assert.equal(rehearsalEnvironment(good).PGUSER, `postgres.${ref}`);
  assert.equal(rehearsalEnvironment(`postgresql://postgres:fixture@db.${ref}.supabase.co/postgres`).PGHOST, `db.${ref}.supabase.co`);
  for (const bad of [undefined, good.replace(ref, BANK_RELEASE.production), good.replace(ref, 'ikcyvlovptebroadgtvd'),
    good.replace('postgres.' + ref, 'postgres'), good + '?sslmode=disable', good.replace('/postgres', '/another'),
    good.replace('pooler.supabase.com', 'pooler.supabase.com.attacker.test')]) {
    assert.throws(() => rehearsalEnvironment(bad));
  }
});

test('diagnostic psql : codes sûrs, jamais le stderr ni un secret', () => {
  for (const [stderr, expected] of [
    ['FATAL: password authentication failed for user private-fixture', 'AUTH_PASSWORD_REJECTED'],
    ['FATAL: Tenant or user not found private-fixture', 'POOLER_TENANT_OR_USER_NOT_FOUND'],
    ['could not translate host name private-fixture', 'NETWORK_DNS'],
    ['ERROR: 42883 private-fixture', 'SQLSTATE_42883'],
    ['unclassified private-fixture postgresql://secret', 'PSQL_EXECUTION_FAILED'],
  ]) {
    const result = psqlFailure({ stderr: Buffer.from(stderr) });
    assert.equal(result, expected);
    assert.ok(!result.includes('private-fixture'));
    assert.ok(!result.includes('secret'));
  }
});

test('sonde de connexion : échec immédiat avant les fichiers métier', () => {
  assert.doesNotThrow(() => requireConnectionProbe(() => ({ status: 0, output: '1\n' }), {}));
  assert.throws(() => requireConnectionProbe(() => ({ status: 1, output: '', failure: 'AUTH_PASSWORD_REJECTED' }), {}), /AUTH_PASSWORD_REJECTED/);
  assert.throws(() => requireConnectionProbe(() => ({ status: 0, output: '' }), {}), /UNEXPECTED_PROBE_RESULT/);
});
test('pgTAP : assertions complètes, erreurs SQL, résumé agrégé et tout ignoré', () => {
  assert.equal(tapVerdict('1..2\nok 1 - first\nok 2 - second\n').passed, true);
  for (const out of ['', '1..0\n', '1..2\nok 1 - partial\n', '1..1\nnot ok 1 - failed\n',
    '1..1\nok 1 - fixture # SKIP unavailable\n',
    '1..1\nok 1\n# Looks like you failed 1 test\n']) assert.equal(tapVerdict(out).passed, false);
  assert.equal(tapVerdict('1..1\nok 1\n', 1).passed, false);
  assert.equal(tapVerdict('1..2\nok 1\nok 2 # SKIP fixture\n').passed, true);
});
