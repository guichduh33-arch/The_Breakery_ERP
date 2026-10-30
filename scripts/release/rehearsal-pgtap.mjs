import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BANK_RELEASE, BANK_SQL_TEST_SHA, BANK_SQL_TEST_COUNT, inspectBankTestSource } from './selective-bank.mjs';
import { isMain, ROOT } from '../agents/lib.mjs';
import { digest } from './bundle-files.mjs';

export function psqlFailure(error) {
  const stderr = error.stderr?.toString() ?? '';
  for (const [pattern, code] of [
    [/password authentication failed/i, 'AUTH_PASSWORD_REJECTED'],
    [/no password supplied/i, 'AUTH_PASSWORD_MISSING'],
    [/tenant or user not found/i, 'POOLER_TENANT_OR_USER_NOT_FOUND'],
    [/circuit breaker|too many authentication/i, 'POOLER_AUTH_RATE_LIMIT'],
    [/could not translate host name|name or service not known/i, 'NETWORK_DNS'],
    [/network is unreachable|no route to host/i, 'NETWORK_UNREACHABLE'],
    [/connection timed out|timeout expired/i, 'NETWORK_TIMEOUT'],
    [/SSL|certificate verify failed/i, 'TLS_CONNECTION_ERROR'],
  ]) if (pattern.test(stderr)) return code;
  const state = stderr.match(/(?:ERROR|FATAL):\s+([0-9A-Z]{5})(?:\s|:|$)/);
  if (state) return `SQLSTATE_${state[1]}`;
  if (error.code === 'ETIMEDOUT') return 'PROCESS_TIMEOUT';
  return 'PSQL_EXECUTION_FAILED';
}

export function psqlFailureLocation(error) {
  // Ne conserver que le chemin relatif du test et sa ligne, jamais le message SQL.
  const match = error.stderr?.toString().match(/psql:[^\r\n]*\/supabase\/tests\/((?:helpers\/)?[a-z0-9_-]+(?:\.test)?\.sql):([1-9][0-9]*):\s+(?:ERROR|FATAL):/);
  return match ? { file: match[1], line: Number(match[2]) } : null;
}

export function requireConnectionProbe(probe, env) {
  const result = probe(env);
  if (result.status !== 0 || result.output.trim() !== '1') {
    throw new Error(`Connexion répétition refusée : ${result.failure ?? 'UNEXPECTED_PROBE_RESULT'}`);
  }
}

export function rehearsalEnvironment(connection) {
  let url;
  try { url = new URL(connection); } catch { throw new Error('Connexion répétition manquante ou invalide.'); }
  const direct = url.hostname === `db.${BANK_RELEASE.rehearsal}.supabase.co`;
  const pooler = url.hostname.endsWith('.pooler.supabase.com');
  const user = decodeURIComponent(url.username);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      !(direct && user === 'postgres' || pooler && user === `postgres.${BANK_RELEASE.rehearsal}`) ||
      url.pathname !== '/postgres' || !url.password || url.search || url.hash) {
    throw new Error('Seule la connexion répétition épinglée est admise.');
  }
  return { PGHOST: url.hostname, PGPORT: url.port || '5432', PGDATABASE: 'postgres',
    PGUSER: user, PGPASSWORD: decodeURIComponent(url.password), PGSSLMODE: 'require',
    PGCONNECT_TIMEOUT: '15', PGAPPNAME: 'bank-selective-rehearsal' };
}

export function tapVerdict(output, status = 0) {
  const plan = [...output.matchAll(/^\s*1\.\.([0-9]+)\s*$/gm)].map((m) => Number(m[1]));
  const assertions = [];
  let invalidSummary = false;
  for (const line of output.split(/\r?\n/)) {
    // Certains tests rendent failures|total|string_agg(TAP, ' | ') via psql -A.
    const summary = line.match(/^\s*(\d+)\|(\d+)\|((?:not )?ok\s+\d+\b.*)$/);
    const rows = summary ? summary[3].split(/ \| (?=(?:not )?ok\s+\d+\b)/) : [line.trim()];
    const parsed = rows.map((row) => row.match(/^(not )?ok\s+(\d+)\b(.*)$/));
    if (summary && (parsed.some((row) => !row) || Number(summary[2]) !== parsed.length ||
        Number(summary[1]) !== parsed.filter((row) => row?.[1]).length)) invalidSummary = true;
    for (const row of parsed) if (row) assertions.push({ number: Number(row[2]), failed: !!row[1], skipped: /#\s*skip\b/i.test(row[3]) });
  }
  const skipped = assertions.filter((row) => row.skipped).length;
  const reasons = [];
  if (status !== 0) reasons.push('PROCESS_FAILED');
  if (invalidSummary) reasons.push('INVALID_AGGREGATE');
  if (/\bnot ok\s+[0-9]+\b|# Looks like you failed [0-9]+ test|Bail out!/i.test(output)) reasons.push('TAP_FAILED');
  if (plan.length !== 1 || plan[0] < 1) reasons.push('INVALID_PLAN');
  if (assertions.length !== plan[0]) reasons.push('ASSERTION_COUNT_MISMATCH');
  if (assertions.some((row, index) => row.number !== index + 1)) reasons.push('INVALID_SEQUENCE');
  if (assertions.length && skipped === assertions.length) reasons.push('ALL_SKIPPED');
  return { passed: reasons.length === 0, assertions: assertions.length, skipped,
    planned: plan.length === 1 ? plan[0] : null,
    failedAssertions: assertions.filter((row) => row.failed).map((row) => row.number), reasons };
}

export function runRehearsalSuite({ root, connection, run, probe, sourceSha }) {
  if (sourceSha !== BANK_SQL_TEST_SHA) throw new Error('SHA des sources SQL incorrect.');
  const connectionEnv = rehearsalEnvironment(connection);
  requireConnectionProbe(probe, connectionEnv);
  const directory = resolve(root, 'supabase/tests');
  if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) throw new Error('Répertoire de tests invalide.');
  const files = readdirSync(directory).filter((f) => f.endsWith('.test.sql')).sort();
  if (files.length !== BANK_SQL_TEST_COUNT) throw new Error('Suite SQL incomplète.');
  const results = [];
  for (const file of files) {
    const path = resolve(directory, file);
    if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error('Fichier SQL irrégulier.');
    const sql = readFileSync(path, 'utf8');
    if (!/^\s*BEGIN\s*;/im.test(sql) || !/^\s*ROLLBACK\s*;/im.test(sql)) throw new Error(`Rollback explicite absent : ${file}`);
    const { output, status, failure, location = null } = run(path, connectionEnv);
    const verdict = tapVerdict(output, status);
    results.push({ file, sha256: digest(Buffer.from(sql)), ...verdict,
      failure: verdict.passed ? null : failure ?? 'TAP_VERDICT_FAILED', location });
  }
  return { schemaVersion: 2, sourceSha, applicationSourceSha: BANK_RELEASE.candidate,
    projectRef: BANK_RELEASE.rehearsal, results,
    passed: results.every((r) => r.passed), publicationAuthorized: false };
}

if (isMain(import.meta.url)) {
  try {
    const root = resolve(process.env.CANDIDATE_DIRECTORY || 'candidate');
    const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    if (execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: root, encoding: 'utf8' }).trim())
      throw new Error('Checkout candidat non propre.');
    inspectBankTestSource({ git: (args) => execFileSync('git', args, {
      cwd: ROOT, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    }) });
    const runPsql = (args, connectionEnv) => {
        // Aucun secret dans les arguments du processus ou les traces du runner.
        const env = { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C.UTF-8', ...connectionEnv };
        try {
          const output = execFileSync('psql', ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate', ...args],
            { env, encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
          return { output, status: 0 };
        } catch (error) {
          return { output: error.stdout?.toString() ?? '', status: 1, failure: psqlFailure(error), location: psqlFailureLocation(error) };
        }
    };
    const result = runRehearsalSuite({ root, connection: process.env.REHEARSAL_PGURL, sourceSha,
      probe: (env) => runPsql(['-c', 'SELECT 1;'], env),
      run: (path, env) => {
        const result = runPsql(['-f', path], env);
        console.log(`${path.split('/').at(-1)} : ${result.status === 0 ? 'executed' : result.failure}`);
        return result;
      },
    });
    writeFileSync('bank-rehearsal-proof.json', JSON.stringify(result, null, 2) + '\n');
    if (!result.passed) throw new Error('Suite SQL répétition échouée ; voir les fichiers refusés dans la preuve.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
