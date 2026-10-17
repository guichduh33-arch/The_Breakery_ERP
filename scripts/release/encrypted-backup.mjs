// Sauvegarde locale préparatoire : aucune installation, purge ou écriture cloud.
// La clé privée est créée uniquement sur le poste de récupération.
import { constants, createCipheriv, createDecipheriv, createHash, createPublicKey, generateKeyPairSync, publicEncrypt, privateDecrypt, randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';

const MAX_BYTES = 128 * 1024 * 1024;
const MAX_FILES = 20000;
const MAGIC = Buffer.from('BREAKERY-BACKUP-1\n');
const digest = (data) => createHash('sha256').update(data).digest('hex');
const fail = (message) => { throw new Error(message); };
const oaep = { padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' };
const areas = ['database', 'storage', 'shop-config', 'bundles', 'terminal-outboxes'];

function regular(path, directory = false) {
  const absolute = resolve(path);
  let cursor = absolute;
  for (;;) {
    if (lstatSync(cursor).isSymbolicLink()) fail('Symbolic links are forbidden.');
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  const stat = lstatSync(absolute);
  if (directory ? !stat.isDirectory() : !stat.isFile()) fail('Unexpected source type.');
  return stat;
}

function safeRelative(value) {
  if (typeof value !== 'string' || !value || value.length > 240 ||
      value.split('/').some((part) => !part || part === '.' || part === '..' ||
        /[\\:\x00-\x1f<>"|?*]/.test(part) || /[. ]$/.test(part) ||
        /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))) {
    fail('Unsafe archive path.');
  }
  return value;
}

function inside(root, path) {
  const rel = relative(root, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}

function validateConfig(config) {
  if (config?.version !== 1 || !/^[a-z0-9]{20}$/.test(config.projectRef ?? '') ||
      config.retentionDays !== 30 || !Array.isArray(config.sources) || !config.sources.length ||
      !config.coverage || areas.some((area) => !['provided', 'missing', 'not-applicable'].includes(config.coverage[area]))) {
    fail('Invalid config: explicit target, sources, coverage and 30-day retention required.');
  }
  const names = new Set();
  for (const source of config.sources) {
    if (!/^[a-z0-9-]{1,48}$/.test(source.name ?? '') || names.has(source.name) ||
        !areas.includes(source.area) || config.coverage[source.area] !== 'provided' ||
        typeof source.path !== 'string' || !isAbsolute(source.path)) fail('Invalid source.');
    names.add(source.name);
  }
  for (const area of areas) {
    if (config.coverage[area] === 'provided' && !config.sources.some((s) => s.area === area)) {
      fail('Provided coverage requires a source.');
    }
  }
}

export function generateRecoveryKeys(directory) {
  if (existsSync(directory)) fail('Key destination must not exist.');
  const keys = generateKeyPairSync('rsa', {
    modulusLength: 3072,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  mkdirSync(directory, { mode: 0o700 });
  writeFileSync(join(directory, 'recovery-private.pem'), keys.privateKey, { flag: 'wx', mode: 0o600 });
  writeFileSync(join(directory, 'backup-public.pem'), keys.publicKey, { flag: 'wx', mode: 0o600 });
  return { publicKeySha256: digest(keys.publicKey) };
}

export function createBackup(config, publicKey, output) {
  validateConfig(config);
  if (existsSync(output)) fail('Backup destination already exists.');
  const recipient = createPublicKey(publicKey);
  if (recipient.asymmetricKeyType !== 'rsa' || recipient.asymmetricKeyDetails.modulusLength < 3072) {
    fail('An RSA recovery key of at least 3072 bits is required.');
  }
  const recoveryPublicDer = recipient.export({ type: 'spki', format: 'der' });
  const files = [];
  let total = 0;
  const destination = resolve(output);
  regular(dirname(destination), true);
  for (const source of config.sources) {
    const root = realpathSync(source.path);
    const stat = regular(source.path, lstatSync(source.path).isDirectory());
    if (inside(root, destination)) fail('Backup output cannot be inside a source.');
    let count = 0;
    const visit = (path, archivePath) => {
      const entry = regular(path, lstatSync(path).isDirectory());
      if (entry.isDirectory()) {
        for (const name of readdirSync(path).sort()) visit(join(path, name), `${archivePath}/${name}`);
        return;
      }
      if ((total += entry.size) > MAX_BYTES || files.length >= MAX_FILES) fail('Backup safety limit exceeded.');
      const data = readFileSync(path);
      const after = lstatSync(path);
      if (data.length !== entry.size || after.size !== entry.size || after.mtimeMs !== entry.mtimeMs) fail('Source changed during backup.');
      // Une clé TLS peut appartenir à la configuration ; la clé de récupération ne doit jamais y entrer.
      if (data.includes(Buffer.from('PRIVATE KEY-----'))) {
        try {
          if (createPublicKey(data).export({ type: 'spki', format: 'der' }).equals(recoveryPublicDer)) {
            fail('Recovery private key cannot be backed up on the shop PC.');
          }
        } catch (error) {
          if (error.message === 'Recovery private key cannot be backed up on the shop PC.') throw error;
        }
      }
      files.push({ path: safeRelative(archivePath), sha256: digest(data), data: data.toString('base64') });
      count++;
    };
    visit(source.path, stat.isDirectory() ? source.name : `${source.name}/snapshot`);
    if (!count) fail('Empty sources cannot establish coverage.');
  }
  return createMemoryBackup({ projectRef: config.projectRef, coverage: config.coverage, files }, publicKey, output);
}

// Exporteurs natifs : chiffrement direct en mémoire, sans dump clair intermédiaire.
export function createMemoryBackup({ projectRef, coverage, files }, publicKey, output) {
  if (!/^[a-z0-9]{20}$/.test(projectRef ?? '') || existsSync(output) ||
      !coverage || areas.some((area) => !['provided', 'missing', 'not-applicable'].includes(coverage[area])) ||
      !Array.isArray(files) || !files.length || files.length > MAX_FILES) fail('Invalid memory snapshot.');
  regular(dirname(resolve(output)), true);
  const recipient = createPublicKey(publicKey);
  if (recipient.asymmetricKeyType !== 'rsa' || recipient.asymmetricKeyDetails.modulusLength < 3072) fail('Invalid recipient.');
  let total = 0;
  const paths = new Set();
  for (const file of files) {
    const path = safeRelative(file.path).toLowerCase();
    const data = Buffer.from(file.data, 'base64');
    if (paths.has(path) || (total += data.length) > MAX_BYTES || digest(data) !== file.sha256) fail('Invalid memory file.');
    if (data.includes(Buffer.from('PRIVATE KEY-----'))) {
      let sameRecipient = false;
      try { sameRecipient = createPublicKey(data).export({ type: 'spki', format: 'der' })
        .equals(recipient.export({ type: 'spki', format: 'der' })); } catch { /* Autre contenu : pas une clé PEM. */ }
      if (sameRecipient) fail('Recovery private key cannot be backed up on the shop PC.');
    }
    paths.add(path);
  }
  const snapshot = {
    version: 1, projectRef, createdAt: new Date().toISOString(),
    retentionDays: 30, coverage, scope: 'supplied-files-only', files,
  };
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const wrapped = publicEncrypt({ key: publicKey, ...oaep }, key);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(wrapped.length);
  const header = Buffer.concat([MAGIC, size, wrapped, iv]);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(header);
  const ciphertext = Buffer.concat([cipher.update(gzipSync(JSON.stringify(snapshot))), cipher.final()]);
  const archive = Buffer.concat([header, ciphertext, cipher.getAuthTag()]);
  writeFileSync(output, archive, { flag: 'wx', mode: 0o600 });
  key.fill(0);
  return { sha256: digest(archive), files: files.length, sourceBytes: total,
    coverage, scope: snapshot.scope, recoveryVerified: false, cloudCopyVerified: false };
}

export function restoreBackup(input, privateKey, destination, expectedProjectRef) {
  // Tout est authentifié et validé avant la création du répertoire de récupération.
  if (existsSync(destination)) fail('Restore destination must not exist.');
  regular(input);
  if (lstatSync(input).size > MAX_BYTES * 2) fail('Archive safety limit exceeded.');
  const archive = readFileSync(input);
  if (!archive.subarray(0, MAGIC.length).equals(MAGIC) || archive.length < MAGIC.length + 4) fail('Invalid archive.');
  const wrappedLength = archive.readUInt32BE(MAGIC.length);
  if (wrappedLength < 256 || wrappedLength > 1024) fail('Invalid key envelope.');
  const offset = MAGIC.length + 4;
  const end = offset + wrappedLength + 12;
  if (archive.length <= end + 16) fail('Truncated archive.');
  const key = privateDecrypt({ key: privateKey, ...oaep }, archive.subarray(offset, offset + wrappedLength));
  const decipher = createDecipheriv('aes-256-gcm', key, archive.subarray(end - 12, end));
  decipher.setAAD(archive.subarray(0, end));
  decipher.setAuthTag(archive.subarray(-16));
  let compressed;
  try { compressed = Buffer.concat([decipher.update(archive.subarray(end, -16)), decipher.final()]); }
  finally { key.fill(0); }
  const snapshot = JSON.parse(gunzipSync(compressed, { maxOutputLength: MAX_BYTES * 2 }).toString('utf8'));
  if (snapshot.version !== 1 || snapshot.projectRef !== expectedProjectRef ||
      !Array.isArray(snapshot.files) || !snapshot.files.length || snapshot.files.length > MAX_FILES) fail('Invalid snapshot or target mismatch.');
  const paths = new Set();
  let total = 0;
  const files = snapshot.files.map((file) => {
    const path = safeRelative(file.path);
    const normalized = path.toLowerCase();
    if (paths.has(normalized)) fail('Duplicate archive path.');
    paths.add(normalized);
    if (typeof file.data !== 'string' || file.data.length % 4 !== 0) fail('Invalid encoded file.');
    const data = Buffer.from(file.data, 'base64');
    // Le décodage Node est permissif ; le retour canonique rejette les caractères
    // ou paddings invalides sans la récursion d'une regexp sur un gros dump.
    if (data.toString('base64') !== file.data) fail('Invalid encoded file.');
    if ((total += data.length) > MAX_BYTES || digest(data) !== file.sha256) fail('File integrity check failed.');
    return { path, data };
  });
  // Un parent lien/jonction est refusé ; aucune restauration sur un terminal actif.
  regular(dirname(resolve(destination)), true);
  mkdirSync(destination, { mode: 0o700 });
  try {
    for (const file of files) {
      const target = join(destination, ...file.path.split('/'));
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      writeFileSync(target, file.data, { flag: 'wx', mode: 0o600 });
    }
  } catch (error) {
    // Aucun effacement automatique : préserver les éléments et diagnostiquer.
    throw new Error('Restore incomplete; preserve isolated directory for inspection.', { cause: error });
  }
  return { files: files.length, sourceBytes: total, projectRef: snapshot.projectRef,
    coverage: snapshot.coverage, scope: 'isolated-files-only', applicationRecoveryVerified: false };
}

export function retentionReview(records, now = new Date()) {
  // Relevé seulement : aucune suppression, même après trente jours.
  return records.map((record) => {
    if (!record || typeof record.id !== 'string' || !Number.isFinite(Date.parse(record.createdAt))) fail('Invalid retention record.');
    return { id: record.id, olderThan30Days: now - new Date(record.createdAt) > 30 * 86400000,
      deletionAuthorized: false };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, ...args] = process.argv.slice(2);
  try {
    let result;
    if (command === 'keys' && args.length === 1) result = generateRecoveryKeys(args[0]);
    else if (command === 'create' && args.length === 3) {
      result = createBackup(JSON.parse(readFileSync(args[0], 'utf8')), readFileSync(args[1]), args[2]);
    } else if (command === 'restore' && args.length === 4) {
      result = restoreBackup(args[0], readFileSync(args[1]), args[2], args[3]);
    } else fail('Usage: keys <new-directory> | create <config.json> <public.pem> <output.bkb> | restore <input.bkb> <private.pem> <new-directory> <project-ref>');
    console.log(JSON.stringify(result, null, 2));
  } catch {
    console.error('Backup operation failed. No secrets are included in diagnostics. Check inputs, target, paths, keys and safety limits.');
    process.exitCode = 1;
  }
}
