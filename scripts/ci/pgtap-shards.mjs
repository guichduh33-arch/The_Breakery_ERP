// Découpage de la suite pgTAP en morceaux parallèles (pgtap-pr.yml, pgtap-nightly.yml).
//
// Avant : un seul job lançait tous les fichiers en série (~45 min). Un fichier
// instable faisait tout relancer. Maintenant :
//   - `plan`      liste les fichiers, applique le plancher, rend la matrice ;
//   - `run`       exécute UN morceau et écrit son bilan JSON ;
//   - `aggregate` relit les bilans : la preuve n'est verte que si l'union des
//                 fichiers exécutés égale EXACTEMENT le plan, sans doublon ni
//                 échec. Un morceau absent, vide ou partiel rend le gate rouge.
//
// Base dev partagée : chaque fichier tourne dans BEGIN … ROLLBACK, mais un DDL
// sur un objet partagé (ALTER TABLE, trigger, fonction, policy, LOCK) pose un
// verrou fort jusqu'au ROLLBACK et bloque ou interbloque les autres sessions.
// Ces fichiers vont dans le morceau `exclusive`, lancé SEUL après les autres.
// Un auteur peut forcer ce classement avec un commentaire `-- pgtap:exclusive`.
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { isMain, ROOT } from '../agents/lib.mjs';

export const TEST_DIR = 'supabase/tests';
export const SHARD_COUNT = 6;
export const EXCLUSIVE = 'exclusive';
// Plancher sur le TOTAL. Un glob cassé ou un checkout partiel rendrait sinon
// le gate vert à vide — le mode de panne le plus coûteux, il ne se voit pas.
export const MIN_FILES = 180;

const SCHEMAS = '(?:public|stock_private|accounting|auth|storage)';
const SHARED_DDL = [
  new RegExp(`^\\s*(?:CREATE\\s+(?:OR\\s+REPLACE\\s+)?|DROP\\s+|ALTER\\s+)FUNCTION\\s+(?:IF\\s+EXISTS\\s+)?${SCHEMAS}\\.`, 'im'),
  new RegExp(`^\\s*(?:GRANT|REVOKE)\\b[^;]*\\bON\\s+(?:FUNCTION|TABLE|SCHEMA|ALL\\s+\\w+\\s+IN\\s+SCHEMA)\\s+${SCHEMAS}\\b`, 'im'),
  /^\s*(?:CREATE|ALTER|DROP)\s+POLICY\b/im,
  /^\s*LOCK\s+(?:TABLE\s+)?\w/im,
  // REFRESH prend ACCESS EXCLUSIVE (EXCLUSIVE avec CONCURRENTLY) jusqu'au ROLLBACK.
  /^\s*REFRESH\s+MATERIALIZED\s+VIEW\b/im,
];
const stripComments = (sql) => sql.replace(/--[^\n]*/g, '');
// Les tables temporaires du fichier ne sont visibles que de sa session : un DDL
// sur elles ne gêne personne.
function tempTables(sql) {
  const names = new Set();
  for (const m of sql.matchAll(/CREATE\s+(?:LOCAL\s+)?TEMP(?:ORARY)?\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:pg_temp\.)?("?[\w]+"?)/gi))
    names.add(m[1].replaceAll('"', '').toLowerCase());
  return names;
}
const bare = (name) => name.replace(/^(?:ONLY\s+)?/i, '').replace(/^pg_temp\./i, '').replaceAll('"', '').toLowerCase();

export function isExclusive(source) {
  if (/^\s*--\s*pgtap:exclusive\b/im.test(source)) return true;
  const sql = stripComments(source);
  if (SHARED_DDL.some((re) => re.test(sql))) return true;
  const temp = tempTables(sql);
  const touchesShared = (target) => {
    if (/^pg_temp\./i.test(target)) return false;
    const name = bare(target).split('.').at(-1);
    return !(bare(target).split('.').length === 1 && temp.has(name));
  };
  for (const m of sql.matchAll(/^\s*(?:ALTER\s+TABLE|TRUNCATE(?:\s+TABLE)?)\s+(?:IF\s+EXISTS\s+)?((?:ONLY\s+)?[\w."]+)/gim))
    if (touchesShared(m[1])) return true;
  // Une fonction non qualifiée naît dans le premier schéma du search_path :
  // seule `pg_temp.` garantit un objet propre à la session.
  for (const m of sql.matchAll(/^\s*(?:CREATE\s+(?:OR\s+REPLACE\s+)?|DROP\s+|ALTER\s+)(?:FUNCTION|PROCEDURE)\s+(?:IF\s+EXISTS\s+)?([\w."]+)/gim))
    if (!/^pg_temp\./i.test(m[1])) return true;
  for (const m of sql.matchAll(/^\s*(?:CREATE|DROP)\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\b[^;]*?\bON\s+([\w."]+)/gim))
    if (touchesShared(m[1])) return true;
  return false;
}

// FNV-1a 32 bits du nom de fichier : stable, sans état, indépendant de l'ordre.
// Ajouter un fichier ne déplace aucun autre fichier de morceau.
export function shardOf(name, count = SHARD_COUNT) {
  let h = 0x811c9dc5;
  for (const ch of Buffer.from(name, 'utf8')) h = Math.imul(h ^ ch, 0x01000193) >>> 0;
  return h % count;
}

export function plan(entries, { count = SHARD_COUNT, min = MIN_FILES } = {}) {
  const files = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  if (files.length < min) throw new Error(`Seulement ${files.length} fichiers pgTAP découverts (plancher ${min}) : glob ou checkout suspect.`);
  if (new Set(files.map((f) => f.name)).size !== files.length) throw new Error('Nom de fichier pgTAP en double.');
  const shards = Object.fromEntries([...Array(count).keys()].map((i) => [String(i), []]));
  shards[EXCLUSIVE] = [];
  for (const f of files) shards[f.exclusive ? EXCLUSIVE : String(shardOf(f.name, count))].push(f.name);
  for (const [id, list] of Object.entries(shards)) if (id !== EXCLUSIVE && !list.length) throw new Error(`Morceau ${id} vide.`);
  return { total: files.length, files: files.map((f) => f.name), shards };
}

export function readSuite(root = ROOT) {
  const dir = join(root, TEST_DIR);
  return readdirSync(dir).filter((n) => n.endsWith('.test.sql'))
    .map((name) => ({ name, exclusive: isExclusive(readFileSync(join(dir, name), 'utf8')) }));
}

// Un fichier échoue sur une erreur psql OU une assertion rouge. Le `not ok` en
// début de ligne ne suffit pas : 17 suites rendent leurs assertions agrégées
// dans une colonne. `finish()` émet le résumé quelle que soit la présentation.
export function verdict(rc, out) {
  const notOk = (out.match(/^[ \t]*not ok [0-9]/gm) ?? []).length;
  const summary = (out.match(/# Looks like you failed [0-9]+ test/g) ?? []).length;
  return { rc, notOk, summary, ok: rc === 0 && notOk === 0 && summary === 0 };
}

export function runShard(names, { psql, now = Date.now, log = console.log } = {}) {
  const results = [];
  for (const name of names) {
    log(`=== Running ${TEST_DIR}/${name} ===`);
    const start = now();
    const { rc, out } = psql(`${TEST_DIR}/${name}`);
    log(out);
    results.push({ file: name, seconds: Math.round((now() - start) / 100) / 10, ...verdict(rc, out) });
  }
  return results;
}

export function aggregate(expected, reports) {
  const errors = [];
  const seen = new Map();
  for (const report of reports) {
    const want = expected.shards[report.shard];
    if (!want) { errors.push(`Bilan d'un morceau inconnu : ${report.shard}`); continue; }
    const got = report.results.map((r) => r.file);
    if (JSON.stringify(got) !== JSON.stringify(want)) errors.push(`Morceau ${report.shard} : ${got.length} fichiers exécutés pour ${want.length} prévus.`);
    for (const r of report.results) {
      seen.set(r.file, (seen.get(r.file) ?? 0) + 1);
      if (!r.ok) errors.push(`${r.file} (exit=${r.rc}, not_ok=${r.notOk}, tap_summary=${r.summary})`);
    }
  }
  for (const id of Object.keys(expected.shards))
    if (expected.shards[id].length && !reports.some((r) => r.shard === id)) errors.push(`Bilan absent pour le morceau ${id}.`);
  const missing = expected.files.filter((f) => !seen.has(f));
  const doubled = [...seen].filter(([, n]) => n > 1).map(([f]) => f);
  const unknown = [...seen.keys()].filter((f) => !expected.files.includes(f));
  if (missing.length) errors.push(`${missing.length} fichier(s) jamais exécuté(s) : ${missing.slice(0, 10).join(', ')}`);
  if (doubled.length) errors.push(`Fichier(s) exécuté(s) deux fois : ${doubled.join(', ')}`);
  if (unknown.length) errors.push(`Fichier(s) hors plan : ${unknown.join(', ')}`);
  return { ok: errors.length === 0, executed: seen.size, total: expected.total, errors };
}

function psqlRunner(url) {
  return (file) => {
    const res = spawnSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-f', file], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const out = `${res.stdout ?? ''}${res.stderr ?? ''}${res.error ? String(res.error) : ''}`;
    return { rc: res.status ?? 1, out: out.replace(/\n$/, '') };
  };
}

if (isMain(import.meta.url)) {
  try {
    const [command, arg] = process.argv.slice(2);
    const expected = plan(readSuite());
    if (command === 'plan') {
      const summary = Object.entries(expected.shards).map(([id, l]) => `${id}=${l.length}`).join(' ');
      console.log(`Fichiers pgTAP découverts : ${expected.total} (${summary})`);
      const matrix = Object.keys(expected.shards).filter((id) => id !== EXCLUSIVE);
      if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,
        `matrix=${JSON.stringify(matrix)}\ntotal=${expected.total}\n`);
    } else if (command === 'run') {
      if (!(arg in expected.shards)) throw new Error(`Morceau inconnu : ${arg}`);
      if (!process.env.PGURL) throw new Error('V3_DEV_PG_POOLER_URL secret is not set');
      const results = runShard(expected.shards[arg], { psql: psqlRunner(process.env.PGURL) });
      mkdirSync(join(ROOT, 'pgtap-results'), { recursive: true });
      writeFileSync(join(ROOT, 'pgtap-results', `${arg}.json`), JSON.stringify({ shard: arg, results }, null, 1));
      const failed = results.filter((r) => !r.ok);
      const seconds = results.reduce((s, r) => s + r.seconds, 0).toFixed(0);
      if (failed.length) {
        console.log(`::error::${failed.length} pgTAP file(s) failed in shard ${arg}:`);
        for (const r of failed) console.log(` - ${r.file} (exit=${r.rc}, not_ok=${r.notOk}, tap_summary=${r.summary})`);
        process.exitCode = 1;
      } else console.log(`Morceau ${arg} : ${results.length} fichiers verts en ${seconds} s.`);
    } else if (command === 'aggregate') {
      const dir = arg ?? join(ROOT, 'pgtap-results');
      const reports = readdirSync(dir).filter((n) => n.endsWith('.json'))
        .map((n) => JSON.parse(readFileSync(join(dir, n), 'utf8')));
      const result = aggregate(expected, reports);
      for (const e of result.errors) console.log(`::error::${e}`);
      if (!result.ok) process.exitCode = 1;
      else console.log(`All ${result.executed} pgTAP files passed (${reports.length} morceaux).`);
    } else throw new Error('Usage : node scripts/ci/pgtap-shards.mjs plan|run <morceau>|aggregate [dossier]');
  } catch (error) { console.error(`::error::${error.message}`); process.exitCode = 1; }
}
