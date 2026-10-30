import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { rehearsalEnvironment, tapVerdict, psqlFailure, psqlFailureLocation, requireConnectionProbe, runRehearsalSuite } from './rehearsal-pgtap.mjs';
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

test('diagnostic SQL : seuls le fichier de test et sa ligne sortent du stderr privé', () => {
  const stderr = 'psql:/home/runner/candidate/supabase/tests/helpers/pin_session.sql:18: ERROR: 42501 secret-fixture\n';
  assert.deepEqual(psqlFailureLocation({ stderr }), { file: 'helpers/pin_session.sql', line: 18 });
  assert.deepEqual(psqlFailureLocation({ stderr: stderr.replace('helpers/pin_session.sql', 'expense_terminology.test.sql') }),
    { file: 'expense_terminology.test.sql', line: 18 });
  for (const text of ['password secret-fixture', stderr.replace('helpers/pin_session.sql', '../../secret.sql'),
    stderr.replace('supabase/tests', 'private')]) assert.equal(psqlFailureLocation({ stderr: text }), null);
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

test('pgTAP : résumé psql agrégé avec contrôle des compteurs et de chaque assertion', () => {
  const output = 'BEGIN\n1..2\nINSERT 0 1\n0|2|ok 1 - first | ok 2 - second\nROLLBACK\n';
  assert.equal(tapVerdict(output).passed, true);
  assert.equal(tapVerdict(output).assertions, 2);
  for (const broken of [output.replace('ok 2', 'not ok 2'), output.replace('0|2|', '1|2|'),
    output.replace('0|2|', '0|3|'), output.replace('ok 2 - second', 'ok 2 - second # SKIP').replace('ok 1 - first', 'ok 1 - first # SKIP')]) {
    assert.equal(tapVerdict(broken).passed, false);
  }
  assert.equal(tapVerdict('1..2\n0|2|ok 1 - first # SKIP fixture | ok 2 - second\n').skipped, 1);
});

test('pgTAP : refuser doublons, trous, plans multiples, bail-out et résumés sans assertions', () => {
  for (const output of ['1..2\nok 1\nok 1\n', '1..2\nok 1\nok 3\n',
    '1..1\nok 1\n1..1\n', '1..1\nok 1\nBail out! fixture\n',
    '1..1\n{"executed":1,"failures":[],"tap_finish":[]}\n']) {
    assert.equal(tapVerdict(output).passed, false);
  }
  assert.deepEqual(tapVerdict('1..2\nok 1\nnot ok 2\n').failedAssertions, [2]);
  assert.ok(tapVerdict('1..2\nok 1\n').reasons.includes('ASSERTION_COUNT_MISMATCH'));
});

test('runner : conserver les vrais refus SQL/TAP et la provenance malgré des résumés valides', () => {
  const root = mkdtempSync(join(tmpdir(), 'rehearsal-verdict-'));
  try {
    mkdirSync(join(root, 'supabase/tests'), { recursive: true });
    for (let i = 0; i < 180; i++) writeFileSync(join(root, `supabase/tests/${i}.test.sql`), 'BEGIN;\nROLLBACK;\n');
    const proof = runRehearsalSuite({ root, sourceSha: BANK_RELEASE.candidate,
      connection: `postgresql://postgres:fixture@db.${BANK_RELEASE.rehearsal}.supabase.co/postgres`,
      probe: () => ({ status: 0, output: '1\n' }),
      run: (path) => basename(path) === '1.test.sql' ? { status: 1, output: '1..1\nok 1\n', failure: 'SQLSTATE_23503' }
        : basename(path) === '2.test.sql' ? { status: 0, output: '1..1\n1|1|not ok 1 - failed\n' }
        : { status: 0, output: '1..1\n0|1|ok 1 - passed\n' },
    });
    assert.equal(proof.results.length, 180);
    assert.equal(proof.results.filter((row) => row.passed).length, 178);
    assert.equal(proof.passed, false);
    assert.equal(proof.publicationAuthorized, false);
    assert.equal(proof.projectRef, BANK_RELEASE.rehearsal);
    assert.equal(proof.sourceSha, BANK_RELEASE.candidate);
    assert.equal(proof.results.find((row) => row.file === '1.test.sql').failure, 'SQLSTATE_23503');
    assert.deepEqual(proof.results.find((row) => row.file === '2.test.sql').failedAssertions, [1]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
