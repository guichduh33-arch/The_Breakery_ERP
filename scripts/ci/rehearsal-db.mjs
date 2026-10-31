import { spawn } from 'node:child_process';
import { readdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { prepareTestFile } from '../../supabase/tests/helpers/prepare_rehearsal_suite.mjs';

export const REHEARSAL_REF = 'getctmbpjnrrjzncaqze';
const API = `https://api.supabase.com/v1/projects/${REHEARSAL_REF}`;

export async function createLogin(token, fetcher = fetch, now = Date.now) {
  if (!token || /[\r\n]/.test(token)) throw new Error('Rehearsal management token required.');
  const response = await fetcher(API + '/cli/login-role', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ read_only: false }), signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Rehearsal login request failed (${response.status}).`);
  const data = await response.json();
  if (data.role !== 'cli_login_postgres' || typeof data.password !== 'string' || !data.password
    || /[\r\n]/.test(data.password) || !Number.isInteger(data.ttl_seconds)
    || data.ttl_seconds < 180 || data.ttl_seconds > 600) throw new Error('Unexpected rehearsal login response.');
  return { role: data.role, password: data.password, expiresAt: now() + data.ttl_seconds * 1000 };
}

export function connectionEnv(env, login) {
  const clean = Object.fromEntries(Object.entries(env)
    .filter(([key]) => !/^PG/i.test(key) && key !== 'REHEARSAL_MANAGEMENT_TOKEN'));
  return { ...clean, PGHOST: 'aws-0-ap-southeast-1.pooler.supabase.com', PGPORT: '5432',
    PGDATABASE: 'postgres', PGUSER: `${login.role}.${REHEARSAL_REF}`, PGPASSWORD: login.password,
    PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '15' };
}

export function tapFailed(output, exitCode) {
  return exitCode !== 0 || /^[ \t]*not ok [0-9]/m.test(output)
    || /# Looks like you failed [0-9]+ test/.test(output);
}

async function psql(args, env) {
  return new Promise((done, reject) => {
    const child = spawn('psql', ['-X', '-v', 'ON_ERROR_STOP=1', ...args], {
      env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Rehearsal SQL file timed out.')); }, 240000);
    const collect = chunk => {
      output += chunk.toString();
      if (output.length > 32 * 1024 * 1024) { child.kill(); reject(new Error('SQL output too large.')); }
    };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.on('error', () => { clearTimeout(timer); reject(new Error('psql could not start.')); });
    child.on('close', code => { clearTimeout(timer); done({ output, code }); });
  });
}

async function run(env, mode) {
  if (env.DB_TEST_TARGET !== 'rehearsal') throw new Error('Explicit rehearsal target required.');
  const token = env.REHEARSAL_MANAGEMENT_TOKEN;
  if (!token) throw new Error('Rehearsal management token required.');
  const temporary = env.RUNNER_TEMP || tmpdir();
  if (mode === '--types') {
    const response = await fetch(API + '/types/typescript?included_schemas=public', {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(120000),
    });
    if (!response.ok) throw new Error(`Rehearsal type generation failed (${response.status}).`);
    const data = await response.json();
    if (typeof data.types !== 'string' || !data.types.includes('export type Database'))
      throw new Error('Invalid generated types response.');
    writeFileSync(join(temporary, 'types_regen_api.ts'), data.types, { mode: 0o600 });
    console.log('Rehearsal public types generated.');
    return;
  }
  let login;
  const connect = async () => {
    // Une nouvelle connexion est acquise avant expiration ; aucune suite concurrente.
    if (!login || login.expiresAt - Date.now() < 120000) {
      login = await createLogin(token);
      if (mode === '--suite') console.log(`Rehearsal login renewed (${REHEARSAL_REF}).`);
    }
    return connectionEnv(env, login);
  };
  if (mode === '--migration-count') {
    const result = await psql(['-qAt', '-c', 'SET ROLE postgres', '-c',
      'SELECT count(*) FROM supabase_migrations.schema_migrations'], await connect());
    if (result.code !== 0 || !/^\d+\s*$/.test(result.output)) throw new Error('Migration count query failed.');
    console.log(result.output.trim());
    return;
  }
  if (mode !== '--suite') throw new Error('Expected --suite, --types or --migration-count.');
  const root = resolve('supabase/tests');
  const files = readdirSync(root).filter(name => name.endsWith('.test.sql')).sort();
  const minimum = Number(env.PGTAP_MIN_FILES || 180);
  if (!Number.isInteger(minimum) || minimum < 180 || files.length < minimum)
    throw new Error('Insufficient pgTAP files; refusing empty coverage.');
  const directory = mkdtempSync(join(temporary, 'rehearsal-pgtap-'));
  const failures = [];
  for (const file of files) {
    const prepared = join(directory, file);
    writeFileSync(prepared, prepareTestFile(join(root, file)), { flag: 'wx', mode: 0o600 });
    console.log(`=== Running supabase/tests/${file} ===`);
    const result = await psql(['-c', 'SET ROLE postgres', '-f', prepared], await connect());
    // La connexion et le jeton ne transitent jamais dans les arguments ni les logs.
    console.log(result.output.replaceAll(login.password, '[REDACTED]').replaceAll(token, '[REDACTED]'));
    if (tapFailed(result.output, result.code)) failures.push(file);
  }
  if (failures.length) throw new Error(`${failures.length} pgTAP files failed: ${failures.join(', ')}`);
  console.log(`All ${files.length} rehearsal pgTAP files passed.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.env, process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
}
