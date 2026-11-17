import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, EXCLUSIVE, isExclusive, plan, readSuite, runShard, shardOf, verdict } from './pgtap-shards.mjs';

const suite = (n, exclusive = []) => [...Array(n).keys()].map((i) => ({ name: `f${i}.test.sql`, exclusive: exclusive.includes(i) }));
const pass = (file) => ({ file, rc: 0, notOk: 0, summary: 0, ok: true });
const reportsOf = (p) => Object.entries(p.shards).filter(([, l]) => l.length).map(([shard, l]) => ({ shard, results: l.map(pass) }));

test('plan : partition complète, déterministe, sans doublon ; le plancher porte sur le total', () => {
  const p = plan(suite(40, [3]), { count: 4, min: 10 });
  const all = Object.values(p.shards).flat().sort();
  assert.deepEqual(all, [...p.files].sort());
  assert.equal(all.length, 40);
  assert.deepEqual(p.shards[EXCLUSIVE], ['f3.test.sql']);
  assert.deepEqual(plan([...suite(40, [3])].reverse(), { count: 4, min: 10 }), p);
  assert.throws(() => plan(suite(9), { count: 4, min: 10 }), /plancher/);
  assert.throws(() => plan([...suite(12), { name: 'f0.test.sql' }], { count: 2, min: 1 }), /double/);
});
test('plan : ajouter un fichier ne déplace aucun autre fichier', () => {
  for (const name of ['a.test.sql', 'zz.test.sql']) assert.equal(shardOf(name, 6), shardOf(name, 6));
  const before = plan(suite(30), { count: 3, min: 1 });
  const after = plan([...suite(30), { name: 'new.test.sql' }], { count: 3, min: 1 });
  for (const f of before.files) assert.equal(Object.keys(after.shards).find((id) => after.shards[id].includes(f)),
    Object.keys(before.shards).find((id) => before.shards[id].includes(f)));
});
test('la vraie suite se découpe au-dessus du plancher', () => {
  const p = plan(readSuite());
  assert.ok(p.total >= 180);
  assert.ok(p.shards[EXCLUSIVE].includes('recipe_reversal_compatibility.test.sql'));
});
test('exclusif : DDL sur objet partagé oui, table temporaire et privilèges cités en texte non', () => {
  for (const sql of ['ALTER TABLE refunds DISABLE TRIGGER USER;', '  ALTER TABLE customers DISABLE TRIGGER t;',
    'CREATE OR REPLACE FUNCTION public.has_permission(p uuid) RETURNS bool', 'DROP FUNCTION IF EXISTS stock_private.f();',
    'CREATE TRIGGER t BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION pg_temp.f();',
    'REVOKE ALL ON FUNCTION public.f() FROM PUBLIC;', 'CREATE POLICY p ON x USING (true);', 'LOCK TABLE public.orders;',
    '-- pgtap:exclusive\nSELECT 1;'])
    assert.equal(isExclusive(sql), true, sql);
  for (const sql of ['CREATE TEMP TABLE hist_ids(id int);\nALTER TABLE hist_ids ADD COLUMN c text;',
    "SELECT ok(NOT has_table_privilege('authenticated','x','UPDATE,TRUNCATE'));", 'GRANT SELECT ON hist_ids TO authenticated;',
    'CREATE FUNCTION pg_temp.f() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql;', '-- ALTER TABLE refunds DISABLE TRIGGER USER;',
    "SELECT ok(position('LOCK TABLE public.journal_entries' IN prosrc) > 0);"])
    assert.equal(isExclusive(sql), false, sql);
});
test('verdict : erreur psql, not ok en tête de ligne ou résumé agrégé suffisent à échouer', () => {
  assert.equal(verdict(0, 'ok 1 - a\nok 2 - b').ok, true);
  assert.equal(verdict(3, 'ok 1').ok, false);
  assert.equal(verdict(0, '    not ok 2 - b').ok, false);
  assert.equal(verdict(0, ' t | not ok 4 - x\n# Looks like you failed 1 test of 4').ok, false);
});
test('runShard : chaque fichier du morceau est exécuté et noté', () => {
  const calls = [];
  const results = runShard(['a.test.sql', 'b.test.sql'], { log: () => {}, now: () => 0,
    psql: (f) => { calls.push(f); return f.endsWith('/b.test.sql') ? { rc: 0, out: 'not ok 1' } : { rc: 0, out: 'ok 1' }; } });
  assert.deepEqual(calls, ['supabase/tests/a.test.sql', 'supabase/tests/b.test.sql']);
  assert.deepEqual(results.map((r) => r.ok), [true, false]);
});
test('aggregate : vert seulement si tous les morceaux couvrent exactement le plan', () => {
  const p = plan(suite(24, [5]), { count: 3, min: 1 });
  const good = reportsOf(p);
  assert.equal(aggregate(p, good).ok, true);
  assert.equal(aggregate(p, good).executed, 24);
  assert.match(aggregate(p, good.slice(1)).errors.join(), /absent/);
  const failing = structuredClone(good); failing[0].results[0] = { ...failing[0].results[0], ok: false, rc: 1 };
  assert.equal(aggregate(p, failing).ok, false);
  const partial = structuredClone(good); partial[0].results.pop();
  assert.match(aggregate(p, partial).errors.join(), /jamais exécuté/);
  const doubled = [...good, good[0]];
  assert.match(aggregate(p, doubled).errors.join(), /deux fois/);
  assert.match(aggregate(p, [...good, { shard: '9', results: [] }]).errors.join(), /inconnu/);
  assert.equal(aggregate(p, []).ok, false);
});
