// Export logique en lecture seule. Aucun restore, installation ou transfert cloud.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createMemoryBackup } from './encrypted-backup.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = () => { throw new Error('Database backup preparation or export failed; no credentials logged.'); };
function pinned(tool) {
  if (!tool || !isAbsolute(tool.path ?? '') || !/^[a-f0-9]{64}$/.test(tool.sha256 ?? '') ||
      lstatSync(tool.path).isSymbolicLink() || !lstatSync(tool.path).isFile() ||
      sha(readFileSync(tool.path)) !== tool.sha256) fail();
}

export function prepareDatabaseBackup(config) {
  const mode = config?.connectionMode ?? 'direct';
  const direct = mode === 'direct' && config?.host === `db.${config?.projectRef}.supabase.co` &&
    /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(config?.user ?? '');
  // Hôte observé dans Connect sur la production V3 le 17 octobre 2026.
  // Le suffixe utilisateur rattache la session au projet explicitement demandé.
  const session = mode === 'session' && config?.host === 'aws-0-ap-southeast-1.pooler.supabase.com' &&
    new RegExp(`^[a-zA-Z_][a-zA-Z0-9_]{0,62}\\.${config?.projectRef}$`).test(config?.user ?? '');
  if (config?.version !== 1 || !/^[a-z0-9]{20}$/.test(config.projectRef ?? '') ||
      (!direct && !session) || config.port !== 5432 || config.database !== 'postgres' ||
      (config.temporaryAccess !== undefined && typeof config.temporaryAccess !== 'boolean') ||
      !isAbsolute(config.passwordFile ?? '') || !isAbsolute(config.rootCertificate ?? '')) fail();
  return { projectRef: config.projectRef, host: config.host, port: 5432, connectionMode: mode,
    temporaryAccess: config.temporaryAccess === true,
    format: 'custom', commands: {
      dump: ['--format=custom', '--no-password', '--lock-wait-timeout=5000'],
      inspect: ['--list'],
    },
    limits: ['Accessible database objects only; cluster roles and platform configuration are not exported.',
      'Storage object bytes require a separate export.',
      'Archive listing does not prove restoration into Supabase.',
      'Database connectivity, trusted CA and protected password file are required.',
      'Temporary access must be explicitly authorized and configured separately; this script never enables it.'],
    applicationRecoveryVerified: false, automationInstalled: false };
}

function capture(executable, args, env, input) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(executable, args, { env, shell: false, windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = [];
    let size = 0;
    let diagnostic = false;
    const timer = setTimeout(() => { child.kill(); reject(new Error('Database export timed out')); }, 300000);
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > 96 * 1024 * 1024) { child.kill(); reject(new Error('Database export limit exceeded')); }
      else chunks.push(chunk);
    });
    // Les messages natifs peuvent contenir des identifiants : aucun journal brut.
    child.stderr.on('data', () => { diagnostic = true; });
    child.on('error', () => { clearTimeout(timer); reject(new Error('Database tool failed')); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 || diagnostic) reject(new Error('Database export requires inspection'));
      else resolveResult(Buffer.concat(chunks));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

export async function exportDatabaseBackup(config, publicKey, output, execution = {}) {
  const plan = prepareDatabaseBackup(config);
  if (execution.execute !== true) return plan;
  if (existsSync(output)) fail();
  pinned(config.pgDump); pinned(config.pgRestore);
  for (const file of [config.passwordFile, config.rootCertificate]) {
    if (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) fail();
  }
  // Ne jamais hériter d'une redirection PGHOST/PGSERVICE ou d'un mot de passe.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG/i.test(key)));
  Object.assign(env, { PGHOST: config.host, PGPORT: '5432', PGDATABASE: 'postgres', PGUSER: config.user,
    PGPASSFILE: config.passwordFile, PGSSLMODE: 'verify-full', PGSSLROOTCERT: config.rootCertificate,
    PGCONNECT_TIMEOUT: '15', PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=240000' +
      (plan.temporaryAccess && plan.connectionMode === 'session' ? ' -c jit=true' : '') });
  const run = execution.capture ?? capture;
  const dump = await run(config.pgDump.path, plan.commands.dump, env);
  if (!Buffer.isBuffer(dump) || dump.length > 96 * 1024 * 1024 || dump.subarray(0, 5).toString() !== 'PGDMP') fail();
  await run(config.pgRestore.path, plan.commands.inspect, env, dump);
  const evidence = Buffer.from(JSON.stringify({ ...plan, createdAt: new Date().toISOString(),
    archiveListingVerified: true, logicalDumpSha256: sha(dump) }));
  const files = [['database/database.dump', dump], ['database/export-evidence.json', evidence]]
    .map(([path, data]) => ({ path, data: data.toString('base64'), sha256: sha(data) }));
  return createMemoryBackup({ projectRef: config.projectRef, files,
    coverage: { database: 'provided', storage: 'missing', 'shop-config': 'missing',
      bundles: 'missing', 'terminal-outboxes': 'missing' } }, publicKey, output);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [configPath, publicKeyPath, output, mode, ...extra] = process.argv.slice(2);
  try {
    if (!configPath || extra.length || (mode && mode !== '--execute')) fail();
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    const result = mode === '--execute'
      ? await exportDatabaseBackup(config, readFileSync(publicKeyPath), output, { execute: true })
      : prepareDatabaseBackup(config);
    console.log(JSON.stringify(result, null, 2));
  } catch { console.error('Database backup failed. Inspect target, native tools and protected credentials.'); process.exitCode = 1; }
}
