import test from 'node:test';
import assert from 'node:assert/strict';
import { createLogin, connectionEnv, tapFailed, REHEARSAL_REF } from './rehearsal-db.mjs';

test('login renewal is bound to rehearsal and requests the documented contract', async () => {
  const result = await createLogin('fixture-token', async (url, request) => {
    assert.equal(url, `https://api.supabase.com/v1/projects/${REHEARSAL_REF}/cli/login-role`);
    assert.equal(request.headers.Authorization, 'Bearer fixture-token');
    assert.deepEqual(JSON.parse(request.body), { read_only: false });
    return { ok: true, json: async () => ({ role: 'cli_login_postgres', password: 'fixture-password', ttl_seconds: 300 }) };
  }, () => 1000);
  assert.equal(result.expiresAt, 301000);
});
test('failed or unexpected login responses cannot select another role', async () => {
  await assert.rejects(createLogin('', () => assert.fail('No request without token')));
  await assert.rejects(createLogin('fixture', async () => ({ ok: false, status: 403 })));
  for (const data of [{ role: 'postgres', password: 'fixture', ttl_seconds: 300 },
    { role: 'cli_login_postgres', password: '', ttl_seconds: 300 },
    { role: 'cli_login_postgres', password: 'fixture', ttl_seconds: 30 }]) {
    await assert.rejects(createLogin('fixture', async () => ({ ok: true, json: async () => data })));
  }
});
test('psql environment cannot inherit another target or the management token', () => {
  const env = connectionEnv({ PGHOST: 'untrusted', PGSERVICE: 'production',
    REHEARSAL_MANAGEMENT_TOKEN: 'fixture-token', PATH: '/bin' },
  { role: 'cli_login_postgres', password: 'fixture-password' });
  assert.equal(env.PGUSER, `cli_login_postgres.${REHEARSAL_REF}`);
  assert.equal(env.PGHOST, 'aws-0-ap-southeast-1.pooler.supabase.com');
  assert.equal(env.PGSERVICE, undefined);
  assert.equal(env.REHEARSAL_MANAGEMENT_TOKEN, undefined);
});
test('TAP failures and aggregated failure summaries remain blocking', () => {
  assert.equal(tapFailed('ok 1 - valid\n1..1', 0), false);
  assert.equal(tapFailed('not ok 1 - invalid', 0), true);
  assert.equal(tapFailed('column | # Looks like you failed 2 tests', 0), true);
  assert.equal(tapFailed('', 3), true);
});
