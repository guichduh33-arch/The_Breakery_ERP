import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rehearsalEnvironment, tapVerdict } from './rehearsal-pgtap.mjs';
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
test('pgTAP : assertions complètes, erreurs SQL, résumé agrégé et tout ignoré', () => {
  assert.equal(tapVerdict('1..2\nok 1 - first\nok 2 - second\n').passed, true);
  for (const out of ['', '1..0\n', '1..2\nok 1 - partial\n', '1..1\nnot ok 1 - failed\n',
    '1..1\nok 1 - fixture # SKIP unavailable\n',
    '1..1\nok 1\n# Looks like you failed 1 test\n']) assert.equal(tapVerdict(out).passed, false);
  assert.equal(tapVerdict('1..1\nok 1\n', 1).passed, false);
  assert.equal(tapVerdict('1..2\nok 1\nok 2 # SKIP fixture\n').passed, true);
});
