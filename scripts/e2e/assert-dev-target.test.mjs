import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertDevTarget } from './assert-dev-target.mjs';

const DEV = 'ikcyvlovptebroadgtvd';
const PROD = 'yjhhhmjgsmyzyymvixot';
const V2 = 'abjabuniwkqpfsenxljp';
const SECRET = 'synthetic-password-never-print';
const FRONTEND = `https://${DEV}.supabase.co`;
const POOLER = 'aws-0-ap-southeast-1.pooler.supabase.com';
/** @param {string} PGURL @param {string} [frontend] */
function envFor(PGURL, frontend = FRONTEND) { return { PGURL, VITE_SUPABASE_URL: frontend }; }

void test('accepte les formats DEV directs et pooler, protocoles et ports Supabase connus', () => {
  for (const protocol of ['postgres', 'postgresql']) {
    for (const port of ['', ':5432']) {
      assert.deepEqual(assertDevTarget(envFor(`${protocol}://postgres:${SECRET}@db.${DEV}.supabase.co${port}/postgres`)),
        { projectRef: DEV, connection: 'direct' });
    }
    for (const port of ['', ':5432', ':6543']) {
      assert.deepEqual(assertDevTarget(envFor(`${protocol}://postgres.${DEV}:${SECRET}@${POOLER}${port}/postgres?sslmode=require`)),
        { projectRef: DEV, connection: 'pooler' });
    }
  }
  assert.equal(assertDevTarget(envFor(`postgresql://postgres%2E${DEV}:${SECRET}@${POOLER}/postgres?sslmode=verify-full&connect_timeout=10`)).connection, 'pooler');
});

void test('refuse production, V2, rôle ambigu, mauvais hôte et options qui redirigent libpq', () => {
  const refused = [
    ...[PROD, V2].flatMap(ref => [
      `postgresql://postgres.${ref}:${SECRET}@${POOLER}:6543/postgres`,
      `postgresql://postgres:${SECRET}@db.${ref}.supabase.co:5432/postgres`,
    ]),
    `postgresql://postgres:${SECRET}@${POOLER}:6543/postgres`,
    `postgresql://postgres.${DEV}:${SECRET}@db.${DEV}.supabase.co/postgres`,
    `postgresql://postgres.${DEV}.extra:${SECRET}@${POOLER}/postgres`,
    `postgresql://service_role.${DEV}:${SECRET}@${POOLER}/postgres`,
    `postgresql://postgres.${DEV}:${SECRET}@${POOLER}.evil.invalid/postgres`,
    `postgresql://postgres.${DEV}:${SECRET}@pooler.supabase.com/postgres`,
    `postgresql://postgres.${DEV}:${SECRET}@${POOLER}:1234/postgres`,
    `postgresql://postgres:${SECRET}@db.${DEV}.supabase.co:6543/postgres`,
    `postgresql://postgres.${DEV}:${SECRET}@${POOLER}/other_database`,
    `postgresql://postgres.${DEV}:${SECRET}@${POOLER}/postgres?host=db.${PROD}.supabase.co`,
    `postgresql://postgres.${DEV}:${SECRET}@${POOLER}/postgres?user=postgres.${PROD}`,
    `postgresql://postgres.${DEV}:${SECRET}@${POOLER}/postgres?service=production`,
    `postgresql://postgres.${DEV}:${SECRET}@${POOLER}/postgres?options=-csearch_path=public`,
    `postgresql://postgres.${DEV}:${SECRET}@${POOLER}/postgres?sslmode=require&sslmode=disable`,
    `postgresql://postgres.${DEV}:${SECRET}@${POOLER}/postgres?sslmode=disable`,
    `postgresql://postgres.${DEV}:${SECRET}@${POOLER}/postgres#ignored`,
  ];
  for (const raw of refused) {
    assert.throws(() => assertDevTarget(envFor(raw)), error => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, 'E2E target must identify dev V3 in both frontend and SQL configuration.');
      assert.ok(!error.stack?.includes(SECRET));
      assert.ok(!error.stack?.includes(raw));
      assert.equal(error.cause, undefined);
      return true;
    });
  }
});

void test('refuse URI malformée ou absente, encodage utilisateur ambigu et frontend non exact sans fuite', () => {
  const malformed = [
    '', `postgresql://${SECRET}`, `postgresql://%ZZ:${SECRET}@${POOLER}/postgres`,
    `postgresql://%E0%A4:${SECRET}@${POOLER}/postgres`,
    `postgresql://postgres.${DEV}:${SECRET}@[broken/postgres`,
    ...['/other/../postgres', '/%2e/postgres', '/%2e%2e/postgres', '/host%3Dother/../postgres', '/post%67res', '/postgres/']
      .map(rawPath => `postgresql://postgres.${DEV}:${SECRET}@${POOLER}${rawPath}`),
    `postgresql://postgres%252E${DEV}:${SECRET}@${POOLER}/postgres`,
    `postgresql://postgres.${DEV}:${SECRET}@${POOLER}/postgres\n`,
    `https://postgres.${DEV}:${SECRET}@${POOLER}/postgres`,
    `postgresql://postgres.${DEV}@${POOLER}/postgres`,
  ];
  for (const raw of malformed) assert.throws(() => assertDevTarget(envFor(raw)), error => {
    assert.ok(error instanceof Error);
    assert.ok(!error.stack?.includes(SECRET));
    assert.equal(error.cause, undefined);
    return true;
  });
  const valid = `postgresql://postgres.${DEV}:${SECRET}@${POOLER}/postgres`;
  for (const frontend of ['', `https://${PROD}.supabase.co`, `https://${V2}.supabase.co`, `${FRONTEND}/`]) {
    assert.throws(() => assertDevTarget(envFor(valid, frontend)));
  }
  assert.throws(() => assertDevTarget({}));
});

void test('CLI ne montre jamais URL ou mot de passe, sur acceptation comme sur refus', () => {
  const helper = fileURLToPath(new URL('./assert-dev-target.mjs', import.meta.url));
  for (const [ref, exit] of [[DEV, 0], [PROD, 1]]) {
    const result = spawnSync(process.execPath, [helper], { encoding: 'utf8', env: {
      ...process.env, VITE_SUPABASE_URL: FRONTEND,
      PGURL: `postgresql://postgres.${ref}:${SECRET}@${POOLER}:6543/postgres`,
    } });
    assert.equal(result.status, exit);
    assert.ok(!result.stdout.includes(SECRET) && !result.stderr.includes(SECRET));
    assert.ok(!result.stdout.includes('postgresql://') && !result.stderr.includes('postgresql://'));
  }
});
