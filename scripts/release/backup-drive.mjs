// Transport préparé pour le Drive privé validé ; aucun login ou install implicite.
// Références : https://rclone.org/drive/ et /commands/rclone_copyto/, /rclone_cat/.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const APPROVED_FOLDER = '1WWBmF8xG5muXnfdIBnWfpaaMspfzMFUN';
const MAGIC = Buffer.from('BREAKERY-BACKUP-1\n');
const sha = (data) => createHash('sha256').update(data).digest('hex');
const fail = () => { throw new Error('Drive backup validation or transfer failed; preserve local archive and inspect configuration.'); };

function regular(path) {
  if (typeof path !== 'string' || !isAbsolute(path)) fail();
  let cursor = resolve(path);
  for (;;) {
    if (lstatSync(cursor).isSymbolicLink()) fail();
    const parent = dirname(cursor);
    if (cursor === parent) break;
    cursor = parent;
  }
  if (!lstatSync(path).isFile()) fail();
}

function validateTransport(config) {
  if (config?.version !== 1 || config.folderId !== APPROVED_FOLDER ||
      !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(config.remote ?? '') ||
      !/^[a-f0-9]{64}$/.test(config.executableSha256 ?? '')) fail();
  regular(config.executable);
  regular(config.configPath);
  if (sha(readFileSync(config.executable)) !== config.executableSha256) fail();
  // La configuration d'auth reste hors Git. Les remotes alias et Shared Drives sont refusés.
  const ini = readFileSync(config.configPath, 'utf8');
  if (ini.length > 1024 * 1024) fail();
  const sections = ini.split(/^\[([^\]\r\n]+)\]\s*$/m);
  let section;
  for (let i = 1; i < sections.length; i += 2) {
    if (sections[i] === config.remote) {
      if (section !== undefined) fail();
      section = sections[i + 1];
    }
  }
  if (section === undefined) fail();
  const entries = new Map();
  for (const line of section.split(/\r?\n/)) {
    if (!line.trim() || /^\s*[#;]/.test(line)) continue;
    const match = /^\s*([a-zA-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || entries.has(match[1])) fail();
    entries.set(match[1], match[2]);
  }
  if (entries.get('type') !== 'drive' || entries.get('team_drive') ||
      entries.get('root_folder_id') !== APPROVED_FOLDER ||
      entries.get('shared_with_me') === 'true' || entries.get('trashed_only') === 'true') fail();
}

export function prepareDriveCopy(receiptPath, config) {
  validateTransport(config);
  regular(receiptPath);
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  if (receipt.version !== 1 || !/^[a-z0-9]{20}$/.test(receipt.projectRef ?? '') ||
      !/^[a-f0-9]{64}$/.test(receipt.sha256 ?? '') || receipt.scope !== 'supplied-files-only' ||
      !Number.isFinite(Date.parse(receipt.createdAt))) fail();
  const date = new Date(receipt.createdAt).toISOString().slice(0, 10);
  const expected = `breakery-${receipt.projectRef}-${date}.bkb`;
  if (receipt.archive !== expected || basename(receiptPath) !== expected.replace('.bkb', '.receipt.json')) fail();
  const archivePath = join(dirname(receiptPath), receipt.archive);
  regular(archivePath);
  if (lstatSync(archivePath).size > 256 * 1024 * 1024) fail();
  const bytes = readFileSync(archivePath);
  if (!bytes.subarray(0, MAGIC.length).equals(MAGIC) || sha(bytes) !== receipt.sha256) fail();
  const remotePath = `${config.remote}:${receipt.projectRef}/${expected.replace('.bkb', `-${receipt.sha256}.bkb`)}`;
  const common = ['--config', config.configPath, '--drive-root-folder-id', APPROVED_FOLDER,
    '--drive-skip-shortcuts', '--drive-shared-with-me=false', '--drive-trashed-only=false',
    '--retries', '3', '--low-level-retries', '3', '--contimeout', '30s', '--timeout', '2m', '--stats', '0'];
  return { archivePath, receipt, remotePath, bytes: bytes.length,
    uploadArgs: ['copyto', archivePath, remotePath, '--ignore-existing', '--immutable', '--checksum', ...common],
    readbackArgs: ['cat', remotePath, ...common] };
}

export function runRclone(executable, args, expectedBytes = 0) {
  return new Promise((resolveRun, reject) => {
    // Aucun shell ; les overrides rclone hérités ne peuvent pas rediriger la destination.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^RCLONE_/i.test(key)));
    const child = spawn(executable, args, { shell: false, windowsHide: true, env,
      stdio: ['ignore', 'pipe', 'ignore'] });
    const hash = createHash('sha256');
    let count = 0;
    let invalid = false;
    const timer = setTimeout(() => { invalid = true; child.kill(); }, 15 * 60 * 1000);
    child.stdout.on('data', (chunk) => {
      count += chunk.length;
      if (count > expectedBytes) { invalid = true; child.kill(); }
      else hash.update(chunk);
    });
    child.on('error', () => { clearTimeout(timer); reject(new Error('rclone could not run; no credentials logged.')); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 || invalid || count !== expectedBytes) {
        reject(new Error('rclone transfer/readback failed; local archive preserved.'));
      } else resolveRun({ bytes: count, sha256: hash.digest('hex') });
    });
  });
}

export async function publishBackup(receiptPath, config, { execute = false, run = runRclone } = {}) {
  const plan = prepareDriveCopy(receiptPath, config);
  if (!execute) return { status: 'prepared-only', folderId: config.folderId,
    sha256: plan.receipt.sha256, cloudCopyVerified: false };
  await run(config.executable, plan.uploadArgs, 0);
  const downloaded = await run(config.executable, plan.readbackArgs, plan.bytes);
  if (downloaded.bytes !== plan.bytes || downloaded.sha256 !== plan.receipt.sha256) fail();
  // La preuve distante est séparée du reçu initial : un essai échoué reste rejouable.
  const proof = { version: 1, status: 'encrypted-cloud-copy-verified',
    folderId: config.folderId, projectRef: plan.receipt.projectRef, sha256: downloaded.sha256,
    bytes: downloaded.bytes, verifiedAt: new Date().toISOString(), cloudCopyVerified: true,
    applicationRecoveryVerified: false, retentionDeletionEnabled: false };
  const proofPath = receiptPath.replace('.receipt.json', `.drive-${Date.now()}.json`);
  writeFileSync(proofPath, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return proof;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [receiptPath, transportPath, mode, ...extra] = process.argv.slice(2);
  try {
    if (!receiptPath || !transportPath || extra.length || (mode && mode !== '--execute')) fail();
    console.log(JSON.stringify(await publishBackup(resolve(receiptPath),
      JSON.parse(readFileSync(transportPath, 'utf8')), { execute: mode === '--execute' }), null, 2));
  } catch {
    console.error('Drive backup failed. No credentials logged; local archive preserved.');
    process.exitCode = 1;
  }
}
