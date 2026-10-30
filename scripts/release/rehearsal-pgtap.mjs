import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BANK_RELEASE } from './selective-bank.mjs';
import { isMain } from '../agents/lib.mjs';
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
  const assertions = output.match(/^\s*(?:not )?ok\s+[0-9]+\b.*$/gm) ?? [];
  const failed = status !== 0 || /\bnot ok\s+[0-9]+\b|# Looks like you failed [0-9]+ test/i.test(output) ||
    plan.length !== 1 || plan[0] < 1 || assertions.length !== plan[0] ||
    assertions.every((line) => /#\s*skip\b/i.test(line));
  return { passed: !failed, assertions: assertions.length,
    skipped: assertions.filter((line) => /#\s*skip\b/i.test(line)).length };
}

export function runRehearsalSuite({ root, connection, run, probe, sourceSha }) {
  if (sourceSha !== BANK_RELEASE.candidate) throw new Error('SHA candidat incorrect.');
  const connectionEnv = rehearsalEnvironment(connection);
  requireConnectionProbe(probe, connectionEnv);
  const directory = resolve(root, 'supabase/tests');
  if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) throw new Error('Répertoire de tests invalide.');
  const files = readdirSync(directory).filter((f) => f.endsWith('.test.sql')).sort();
  if (files.length < 180) throw new Error('Suite SQL incomplète.');
  const results = [];
  for (const file of files) {
    const path = resolve(directory, file);
    if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error('Fichier SQL irrégulier.');
    const sql = readFileSync(path, 'utf8');
    if (!/^\s*BEGIN\s*;/im.test(sql) || !/^\s*ROLLBACK\s*;/im.test(sql)) throw new Error(`Rollback explicite absent : ${file}`);
    const { output, status, failure } = run(path, connectionEnv);
    const verdict = tapVerdict(output, status);
    results.push({ file, sha256: digest(Buffer.from(sql)), ...verdict,
      failure: verdict.passed ? null : failure ?? 'TAP_VERDICT_FAILED' });
  }
  return { schemaVersion: 1, sourceSha, projectRef: BANK_RELEASE.rehearsal, results,
    passed: results.every((r) => r.passed), publicationAuthorized: false };
}

if (isMain(import.meta.url)) {
  try {
    const root = resolve(process.env.CANDIDATE_DIRECTORY || 'candidate');
    const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    if (execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: root, encoding: 'utf8' }).trim())
      throw new Error('Checkout candidat non propre.');
    const runPsql = (args, connectionEnv) => {
        // Aucun secret dans les arguments du processus ou les traces du runner.
        const env = { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C.UTF-8', ...connectionEnv };
        try {
          const output = execFileSync('psql', ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate', ...args],
            { env, encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
          return { output, status: 0 };
        } catch (error) {
          return { output: error.stdout?.toString() ?? '', status: 1, failure: psqlFailure(error) };
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
