import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDbTestTarget } from './db-test-target.mjs';

const dev = 'postgresql://postgres.ikcyvlovptebroadgtvd:fixture@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres';
const rehearsal = 'postgresql://cli_login_postgres.getctmbpjnrrjzncaqze:fixture@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres';

test('default retains the development target', () => {
  assert.equal(resolveDbTestTarget({ DEV_PGURL: dev }).target, 'dev');
});
test('rehearsal uses its own connection and project', () => {
  const result = resolveDbTestTarget({ DB_TEST_TARGET: 'rehearsal', DEV_PGURL: dev, REHEARSAL_PGURL: rehearsal });
  assert.equal(result.connection, rehearsal);
  assert.equal(result.ref, 'getctmbpjnrrjzncaqze');
});
test('missing rehearsal secret never falls back to dev', () => {
  assert.throws(() => resolveDbTestTarget({ DB_TEST_TARGET: 'rehearsal', DEV_PGURL: dev }), /fallback/);
});
test('production, crossed projects, and unknown targets are refused', () => {
  for (const connection of [dev, rehearsal.replace('getctmbpjnrrjzncaqze', 'yjhhhmjgsmyzyymvixot'), rehearsal.replace('pooler.supabase.com', 'example.com')]) {
    assert.throws(() => resolveDbTestTarget({ DB_TEST_TARGET: 'rehearsal', REHEARSAL_PGURL: connection }));
  }
  assert.throws(() => resolveDbTestTarget({ DB_TEST_TARGET: 'production', DEV_PGURL: dev }));
});
test('line injection and missing credentials are refused', () => {
  for (const connection of [rehearsal + '\nUNTRUSTED=value', rehearsal.replace(':fixture@', '@')]) {
    assert.throws(() => resolveDbTestTarget({ DB_TEST_TARGET: 'rehearsal', REHEARSAL_PGURL: connection }));
  }
});
test('libpq routing overrides and weakened TLS are refused', () => {
  for (const query of ['host=db.yjhhhmjgsmyzyymvixot.supabase.co&user=postgres',
    'hostaddr=127.0.0.1', 'dbname=other', 'service=production', 'options=-crole=postgres',
    'sslmode=disable', 'sslmode=require&sslmode=disable', '%68ost=other']) {
    assert.throws(() => resolveDbTestTarget({ DB_TEST_TARGET: 'rehearsal', REHEARSAL_PGURL: rehearsal + '?' + query }));
  }
  assert.equal(resolveDbTestTarget({ DB_TEST_TARGET: 'rehearsal',
    REHEARSAL_PGURL: rehearsal + '?sslmode=require&connect_timeout=15' }).target, 'rehearsal');
  assert.throws(() => resolveDbTestTarget({ DB_TEST_TARGET: 'rehearsal', REHEARSAL_PGURL: rehearsal.replace(':5432/', ':6543/') }));
});
