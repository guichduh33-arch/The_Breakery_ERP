// Configuration boutique : liste explicite de fichiers, jamais un profil navigateur.
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createMemoryBackup } from './encrypted-backup.mjs';

const REQUIRED = ['launcher', 'registry', 'hub-buffer', 'tls-certificate', 'tls-private-key'];
const OPTIONAL = ['startup-task', 'runtime-config'];
const sha = (data) => createHash('sha256').update(data).digest('hex');

function readRegular(path) {
  if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('Explicit absolute file paths required');
  for (let cursor = resolve(path);;) {
    if (lstatSync(cursor).isSymbolicLink()) throw new Error('Links are forbidden');
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  const before = lstatSync(path);
  if (!before.isFile() || before.size > 16 * 1024 * 1024) throw new Error('Invalid shop configuration file');
  const data = readFileSync(path);
  const after = lstatSync(path);
  if (before.size !== data.length || before.mtimeMs !== after.mtimeMs || before.size !== after.size) {
    throw new Error('Shop configuration changed while being read');
  }
  return data;
}

export function createShopConfigurationBackup(config, publicKey, output) {
  if (config?.version !== 1 || !/^[a-z0-9]{20}$/.test(config.projectRef ?? '') ||
      !Array.isArray(config.files) || config.files.length > 7) throw new Error('Invalid shop configuration selection');
  const roles = config.files.map((file) => file.role);
  if (new Set(roles).size !== roles.length || REQUIRED.some((role) => !roles.includes(role)) ||
      roles.some((role) => ![...REQUIRED, ...OPTIONAL].includes(role))) throw new Error('Missing or unexpected configuration role');
  const target = readRegular(config.targetSource);
  const refs = [...target.toString('utf8').matchAll(/([a-z0-9]{20})\.supabase\.co/g)].map((m) => m[1]);
  if (!refs.length || refs.some((ref) => ref !== config.projectRef)) throw new Error('Shop target mismatch');
  const inventory = [];
  const files = config.files.map((file) => {
    const data = readRegular(file.path);
    inventory.push({ role: file.role, source: file.path, sha256: sha(data), bytes: data.length });
    return { path: `shop-config/${file.role}`, sha256: sha(data), data: data.toString('base64') };
  });
  const evidence = Buffer.from(JSON.stringify({ version: 1, projectRef: config.projectRef,
    createdAt: new Date().toISOString(), targetSource: config.targetSource, targetSourceSha256: sha(target),
    targetProof: 'selected-file-only', inventory, applicationRecoveryVerified: false,
    limits: ['Files are read individually; this is not an atomic hub snapshot.',
      'Browser queues, cloud secrets and Windows task registration are not included.',
      'Recheck the active service and exact loaded bundle before restoration.'] }));
  files.push({ path: 'shop-config/export-evidence.json', data: evidence.toString('base64'), sha256: sha(evidence) });
  return createMemoryBackup({ projectRef: config.projectRef, files,
    coverage: { database: 'missing', storage: 'missing', 'shop-config': 'provided',
      bundles: 'missing', 'terminal-outboxes': 'missing' } }, publicKey, output);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [configPath, publicPath, output, ...extra] = process.argv.slice(2);
  try {
    if (!configPath || !publicPath || !output || extra.length) throw new Error('Invalid arguments');
    console.log(JSON.stringify(createShopConfigurationBackup(JSON.parse(readFileSync(configPath, 'utf8')),
      readFileSync(publicPath), output), null, 2));
  } catch { console.error('Shop configuration backup failed; no secret contents logged.'); process.exitCode = 1; }
}
