// Rotation distante bornée aux reçus locaux ET à leur preuve de relecture réussie.
// Aucun effacement local, récursif, ni déduction depuis le seul nom d'un fichier Drive.
import { appendFileSync, closeSync, existsSync, fsyncSync, lstatSync, openSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = () => { throw new Error('Backup retention could not be verified; preserve files and inspect the rotation journal.'); };
const regular = (path) => lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink();
function record(path, entry, status) {
  // Le marqueur durable précède la suppression. Une ligne partielle bloque la reprise.
  const fd = openSync(path, 'a', 0o600);
  try { appendFileSync(fd, JSON.stringify({ remotePath: entry.remotePath, status }) + '\n'); fsyncSync(fd); }
  finally { closeSync(fd); }
  entry.status = status;
}

export async function rotateBackups({ receiptPath, config, plan, run, planReceipt, now = new Date() }) {
  if (!Number.isFinite(now.getTime())) fail();
  const database = plan.receipt.database;
  // Les anciens reçus « fichiers fournis seulement » restent transférables sans rotation.
  if (plan.receipt.coverage?.database !== 'provided' || database?.projectRef !== plan.receipt.projectRef ||
      database?.archiveListingVerified !== true || !/^[a-f0-9]{64}$/.test(database.logicalDumpSha256 ?? '') ||
      !Number.isFinite(Date.parse(database.startedAt)) || !Number.isFinite(Date.parse(database.completedAt)) ||
      Date.parse(database.completedAt) < Date.parse(database.startedAt)) {
    return { deleted: 0, skipped: 'fresh-database-evidence-missing', preservedUnknown: true };
  }
  const directory = dirname(receiptPath);
  const names = readdirSync(directory).sort();
  if (names.length > 20000) fail();
  const prefix = `breakery-${plan.receipt.projectRef}-`;
  const candidates = [];
  for (const name of names) {
    if (!name.startsWith(prefix) || !/^breakery-[a-z0-9]{20}-\d{4}-\d{2}-\d{2}\.receipt\.json$/.test(name) ||
        name === basename(receiptPath)) continue;
    const path = join(directory, name);
    if (!regular(path)) continue;
    const receipt = JSON.parse(readFileSync(path, 'utf8'));
    // Une reprise tardive n'avance jamais la date de la photographie conservée.
    if (!(Math.min(now.getTime(), Date.parse(plan.receipt.createdAt)) - new Date(receipt.createdAt) > 30 * 86400000) ||
        receipt.retentionDays !== 30) continue;
    const proofPrefix = name.replace('.receipt.json', '.drive-');
    const verified = names.some((proofName) => {
      if (!proofName.startsWith(proofPrefix) || !/^.+\.drive-\d+(?:-[a-f0-9]{16})?\.json$/.test(proofName)) return false;
      const proofPath = join(directory, proofName);
      if (!regular(proofPath)) return false;
      const proof = JSON.parse(readFileSync(proofPath, 'utf8'));
      return proof.version === 1 && proof.status === 'encrypted-cloud-copy-verified' &&
        proof.cloudCopyVerified === true && proof.folderId === config.folderId &&
        proof.projectRef === plan.receipt.projectRef && proof.sha256 === receipt.sha256 &&
        proof.receiptSha256 === sha(readFileSync(path));
    });
    if (!verified) continue;
    const previous = planReceipt(path, config);
    candidates.push({ remotePath: previous.remotePath, name: previous.remotePath.split('/').at(-1),
      bytes: previous.bytes, sha256: receipt.sha256, createdAt: receipt.createdAt, status: 'pending' });
  }
  const journalPath = receiptPath.replace('.receipt.json', '.retention.json');
  const eventsPath = receiptPath.replace('.receipt.json', '.retention-events.jsonl');
  let journal;
  if (existsSync(journalPath)) {
    if (!regular(journalPath)) fail();
    journal = JSON.parse(readFileSync(journalPath, 'utf8'));
    if (journal.version !== 1 || journal.projectRef !== plan.receipt.projectRef ||
        journal.currentSha256 !== plan.receipt.sha256 || journal.folderId !== config.folderId ||
        !Array.isArray(journal.entries) || journal.entries.length > 20000 ||
        new Set(journal.entries.map((entry) => entry.remotePath)).size !== journal.entries.length) fail();
    for (const entry of journal.entries) {
      const original = candidates.find((candidate) => candidate.remotePath === entry.remotePath);
      if (!original || ['name', 'bytes', 'sha256', 'createdAt'].some((key) => original[key] !== entry[key]) ||
          !['pending', 'deleting', 'deleted', 'already-absent'].includes(entry.status)) fail();
    }
  } else {
    journal = { version: 1, projectRef: plan.receipt.projectRef, folderId: config.folderId,
      currentSha256: plan.receipt.sha256, startedAt: now.toISOString(), entries: candidates };
    writeFileSync(journalPath, JSON.stringify(journal, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  }
  if (existsSync(eventsPath)) {
    if (!regular(eventsPath) || lstatSync(eventsPath).size > 16 * 1024 * 1024) fail();
    const events = readFileSync(eventsPath, 'utf8');
    if (!events.endsWith('\n')) fail();
    for (const line of events.trimEnd().split('\n')) {
      const event = JSON.parse(line);
      const entry = journal.entries.find((item) => item.remotePath === event.remotePath);
      if (!entry || !['deleting', 'deleted', 'already-absent'].includes(event.status) ||
          (event.status !== 'deleting' && entry.status !== 'deleting') ||
          (event.status === 'deleting' && !['pending', 'deleting'].includes(entry.status))) fail();
      entry.status = event.status;
    }
  }
  if (!journal.entries.length) return { journal: basename(journalPath), deleted: 0, preservedUnknown: true };
  const listed = await run(config.executable, plan.listArgs, null);
  if (!Array.isArray(listed) || listed.length > 20000) fail();
  for (const entry of journal.entries) {
    if (['deleted', 'already-absent'].includes(entry.status)) continue;
    const matches = listed.filter((remote) => remote.Name === entry.name || remote.Path === entry.name);
    if (!matches.length && entry.status === 'deleting') { record(eventsPath, entry, 'already-absent'); continue; }
    if (!matches.length) continue;
    if (matches.length !== 1 || matches[0].IsDir !== false || matches[0].Name !== entry.name ||
        matches[0].Path !== entry.name || matches[0].Size !== entry.bytes) fail();
    record(eventsPath, entry, 'deleting');
    await run(config.executable, ['deletefile', entry.remotePath, ...plan.commonArgs], 0);
    record(eventsPath, entry, 'deleted');
  }
  return { journal: basename(journalPath), deleted: journal.entries.filter((entry) =>
    ['deleted', 'already-absent'].includes(entry.status)).length, preservedUnknown: true };
}
