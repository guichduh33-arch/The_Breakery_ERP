// Lanceur local à planifier après validation de l'installation et du compte Windows.
// Aucun compte cloud configuré implicitement ; transfert uniquement avec --upload.
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { collectBackupFiles, createMemoryBackup } from './encrypted-backup.mjs';
import { acquireDatabaseSnapshot } from './database-backup.mjs';
import { publishBackup } from './backup-drive.mjs';

export async function runDailyBackup({ configPath, publicKeyPath, outputDirectory, now = new Date() }, execution = {}) {
  const directory = resolve(outputDirectory);
  if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) {
    throw new Error('An existing dedicated local output directory is required.');
  }
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  if (!/^[a-z0-9]{20}$/.test(config.projectRef ?? '')) throw new Error('Explicit project required.');
  if (!config.database || config.database.projectRef !== config.projectRef || config.coverage?.database !== 'provided') {
    throw new Error('A fresh native database export for the exact project is required.');
  }
  const date = now.toISOString().slice(0, 10);
  const name = `breakery-${config.projectRef}-${date}`;
  // Un échec après création conserve l'archive ; le prochain essai ne l'écrase jamais.
  const archive = join(directory, `${name}.bkb`);
  const receiptPath = join(directory, `${name}.receipt.json`);
  if (existsSync(archive) || existsSync(receiptPath)) throw new Error('Daily output exists; inspect before retrying.');
  const publicKey = readFileSync(publicKeyPath);
  const supplied = collectBackupFiles(config, publicKey, archive, true);
  const { files, evidence } = await acquireDatabaseSnapshot(config.database, execution);
  const components = config.sources.map(({ name, area }) => ({ name, area,
    files: supplied.filter((file) => file.path.startsWith(`${name}/`)).map(({ path, sha256 }) => ({ path, sha256 })) }));
  const manifest = Buffer.from(JSON.stringify({ version: 1, projectRef: config.projectRef,
    coverage: config.coverage, database: evidence, components }));
  const result = createMemoryBackup({ projectRef: config.projectRef, coverage: config.coverage,
    files: [...files, ...supplied, { path: 'daily/capture-manifest.json', data: manifest.toString('base64'),
      sha256: createHash('sha256').update(manifest).digest('hex') }] }, publicKey, archive);
  const receipt = { version: 1, archive: `${name}.bkb`, createdAt: now.toISOString(),
    projectRef: config.projectRef, retentionDays: 30, ...result, database: evidence,
    components: components.map(({ name, area, files }) => ({ name, area, files: files.length })),
    status: 'local-encrypted-only', dailyAutomationInstalled: false,
    limits: ['Fresh logical database dump and explicitly supplied non-database components only.',
      'No cloud upload, cloud readback or recovery of an application demonstrated.',
      'Rotation requires a fully verified new cloud copy; unknown remote files are preserved.'] };
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return receipt;
}

export async function runDailyBackupWithDrive(options, transport, execution = {}) {
  const config = JSON.parse(readFileSync(options.configPath, 'utf8'));
  if (!/^[a-z0-9]{20}$/.test(config.projectRef ?? '')) throw new Error('Explicit project required.');
  const date = (options.now ?? new Date()).toISOString().slice(0, 10);
  const receiptPath = join(resolve(options.outputDirectory), `breakery-${config.projectRef}-${date}.receipt.json`);
  // Une relance réutilise le même chiffré : jamais de nouvelle photographie sous la même identité.
  if (!existsSync(receiptPath)) await runDailyBackup(options, execution);
  return publishBackup(receiptPath, transport, execution);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [configPath, publicKeyPath, outputDirectory, transportPath, mode, ...extra] = process.argv.slice(2);
  try {
    if (!configPath || !publicKeyPath || !outputDirectory || extra.length ||
        (transportPath ? mode !== '--upload' : mode)) throw new Error('Invalid arguments.');
    const options = { configPath, publicKeyPath, outputDirectory };
    const result = transportPath
      ? await runDailyBackupWithDrive(options, JSON.parse(readFileSync(transportPath, 'utf8')), { execute: true })
      : await runDailyBackup(options);
    console.log(JSON.stringify(result, null, 2));
  } catch {
    console.error('Daily backup failed. Inspect local inputs and existing outputs; no secrets logged.');
    process.exitCode = 1;
  }
}
