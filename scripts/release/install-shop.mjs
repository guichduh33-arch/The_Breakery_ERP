// Installation boutique du lanceur réel : préparer, basculer, rétablir, vérifier.
// Aucune dépendance npm : ce fichier voyage dans le paquet et tourne sur le PC boutique.
// Toutes les identités (SHA, empreinte d'archive) viennent du paquet et de son digest CI,
// jamais d'une constante éditée à la main pour une livraison.
import { constants, copyFileSync, cpSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crc32, inflateRawSync } from 'node:zlib';
import { hash, requireInstallable, verifyInstalled, verifyServed, verifyShop } from './verify-shop.mjs';

const HEX64 = /^[a-f0-9]{64}$/;
const need = (value, message) => { if (!value) throw new Error(message); };
// Le lanceur réel est du JavaScript : ses chemins Windows y sont écrits en littéral échappé.
export const literal = (value) => JSON.stringify(value).slice(1, -1);
const lower = (value) => value.toLowerCase();
// Comparaison insensible à la casse : les chemins Windows le sont.
const inside = (path, root) => {
  const rel = relative(lower(resolve(root)), lower(resolve(path)));
  return !!rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};
const count = (text, needle) => text.split(needle).length - 1;

const PATHS = ['nodePath', 'launcherPath', 'externalConfigPath', 'previousRelease', 'releasesDir',
  'oldBridgeEntry', 'oldPosDist', 'caCertificate', 'archivePath'];
const DIGESTS = ['nodeSha256', 'launcherSha256', 'externalConfigSha256'];

export function readConfig(text) {
  const c = JSON.parse(text);
  need(c && c.version === 2, 'Unknown shop configuration; version 2 required');
  need(/^[a-f0-9]{40}$/.test(c.sha), 'Explicit release SHA required');
  for (const key of ['taskName', 'taskPath', 'taskUser']) need(typeof c[key] === 'string' && c[key] && !/[\r\n]/.test(c[key]), 'Explicit task identity required');
  for (const key of PATHS) need(typeof c[key] === 'string' && isAbsolute(c[key]) && !/[\r\n]/.test(c[key]), 'Explicit absolute paths required');
  for (const key of DIGESTS) need(HEX64.test(c[key]), 'Explicit SHA-256 digests required');
  need(Array.isArray(c.origins) && c.origins.length > 0, 'At least one shop origin required');
  for (const origin of c.origins) {
    const url = new URL(origin);
    need(url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash
      && url.href === origin, 'Exact HTTPS shop origin required');
  }
  need(new Set(c.origins).size === c.origins.length, 'Duplicate shop origin');
  need(inside(c.previousRelease, c.releasesDir), 'Previous release must be inside the releases directory');
  need(inside(c.oldBridgeEntry, c.previousRelease) && inside(c.oldPosDist, c.previousRelease), 'Old bridge and POS paths must belong to the previous release');
  const destination = join(c.releasesDir, c.sha);
  for (const key of ['launcherPath', 'externalConfigPath']) {
    need(!inside(c[key], c.previousRelease) && !inside(c[key], destination), 'Launcher and external configuration must stay outside the swapped releases');
  }
  return c;
}

// Lecture d'une seule entrée d'un zip (stocké ou deflate) pour relier le paquet extrait à son archive.
export function readZipEntry(bytes, name) {
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  need(end >= 0, 'Archive is not a zip file');
  const total = bytes.readUInt16LE(end + 10), size = bytes.readUInt32LE(end + 12), offset = bytes.readUInt32LE(end + 16);
  need(total !== 0xffff && size !== 0xffffffff && offset !== 0xffffffff && offset + size <= end, 'Unsupported archive layout');
  const found = [];
  for (let at = offset, i = 0; i < total; i++) {
    need(bytes.readUInt32LE(at) === 0x02014b50, 'Corrupt archive directory');
    const nameLength = bytes.readUInt16LE(at + 28), skip = nameLength + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32);
    const entry = bytes.subarray(at + 46, at + 46 + nameLength).toString('utf8').replace(/\\/g, '/');
    if (entry === name) found.push({ flags: bytes.readUInt16LE(at + 8), method: bytes.readUInt16LE(at + 10), crc: bytes.readUInt32LE(at + 16),
      compressed: bytes.readUInt32LE(at + 20), size: bytes.readUInt32LE(at + 24), local: bytes.readUInt32LE(at + 42) });
    at += 46 + skip;
  }
  need(found.length === 1, 'Archive must contain exactly one ' + name);
  const [e] = found;
  need(!(e.flags & 1) && [0, 8].includes(e.method), 'Unsupported archive entry');
  need(bytes.readUInt32LE(e.local) === 0x04034b50, 'Corrupt archive entry');
  const start = e.local + 30 + bytes.readUInt16LE(e.local + 26) + bytes.readUInt16LE(e.local + 28);
  const raw = bytes.subarray(start, start + e.compressed);
  const data = e.method === 8 ? inflateRawSync(raw) : Buffer.from(raw);
  need(data.length === e.size && crc32(data) === e.crc, 'Corrupt archive entry');
  return data;
}

export function readDigestFile(text) {
  const value = text.replace(/^\uFEFF/, '').trim().split(/\s+/)[0]?.toLowerCase();
  need(HEX64.test(value ?? ''), 'CI archive digest file is invalid');
  return value;
}

// Remplace exactement une fois chaque chemin échappé ; refuse toute autre trace de l'ancienne release.
export function rewriteLauncher(source, old, next) {
  let result = source;
  for (const [before, after] of [[old.oldBridgeEntry, next.bridgeEntry], [old.oldPosDist, next.posDist]]) {
    const needle = literal(before), at = result.indexOf(needle), quote = result[at - 1];
    // Le chemin doit être une chaîne entière : un préfixe (`...\\dist-old`) n'est pas le chemin vérifié.
    need(count(result, needle) === 1 && ['"', "'", '`'].includes(quote) && result[at + needle.length] === quote,
      'Launcher layout is not verified: expected exactly one escaped path');
    result = result.slice(0, at) + literal(after) + result.slice(at + needle.length);
  }
  const text = lower(result);
  for (const form of [literal(old.previousRelease), old.previousRelease, old.previousRelease.replace(/\\/g, '/')]) {
    need(!text.includes(lower(form)), 'Other previous-release paths remain in the launcher');
  }
  need(count(result, literal(old.externalConfigPath)) >= 1, 'External configuration must remain referenced by the launcher');
  return result;
}

export function decodeLauncher(bytes) {
  need(!bytes.includes(0) && !(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf), 'Launcher must be UTF-8 without BOM');
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export function layout(c) {
  const destination = join(c.releasesDir, c.sha);
  return { destination, report: join(destination, 'installation.json'),
    backup: `${c.launcherPath}.rollback-${c.sha}`, temp: `${c.launcherPath}.update-${c.sha}`, restore: `${c.launcherPath}.restore-${c.sha}`,
    next: { bridgeEntry: join(destination, 'apps', 'print-bridge', 'dist', 'server.js'), posDist: join(destination, 'apps', 'pos', 'dist') } };
}

const digestOf = (path) => hash(readFileSync(path));
const writeReport = (path, data, flag = 'w') => writeFileSync(path, JSON.stringify(data, null, 2), { flag });
function readReport(path, states) {
  const report = JSON.parse(readFileSync(path, 'utf8'));
  need(states.includes(report.state), `Installation report is ${report.state}, expected ${states.join(' or ')}`);
  return report;
}

async function health(origin) {
  const response = await fetch(new URL('/health', origin), { redirect: 'error', signal: AbortSignal.timeout(10000) });
  need(response.ok, `Service is not healthy on ${origin}`);
  const body = await response.json();
  need(body?.status === 'ok', `Service is not healthy on ${origin}`);
  return body.release_sha ?? null;
}

export async function stage(c, packageRoot) {
  const archive = readFileSync(c.archivePath);
  const archiveSha256 = hash(archive);
  need(archiveSha256 === readDigestFile(readFileSync(`${c.archivePath}.sha256`, 'utf8')), 'Archive differs from its CI digest');
  need(readZipEntry(archive, 'release.json').equals(readFileSync(join(packageRoot, 'release.json'))), 'Extracted package differs from the archive');
  const manifest = verifyShop(packageRoot, c.sha);
  requireInstallable(manifest);
  need(digestOf(c.nodePath) === c.nodeSha256, 'Node runtime differs from the verified digest');
  need(digestOf(c.externalConfigPath) === c.externalConfigSha256, 'External configuration differs from the verified digest');
  const original = readFileSync(c.launcherPath);
  need(hash(original) === c.launcherSha256, 'Launcher changed; refresh the local configuration');
  const previous = {};
  for (const origin of c.origins) previous[origin] = await health(origin);
  const l = layout(c);
  for (const path of [l.destination, l.backup, l.temp, l.restore]) need(!existsSync(path), 'Release or launcher copies already exist; read the installation report before retrying');
  const updated = rewriteLauncher(decodeLauncher(original), c, l.next);
  cpSync(join(packageRoot, 'payload'), l.destination, { recursive: true, force: false, errorOnExist: true });
  verifyInstalled(packageRoot, l.destination);
  copyFileSync(c.launcherPath, l.backup, constants.COPYFILE_EXCL);
  writeFileSync(l.temp, updated, { flag: 'wx' });
  const report = { version: 2, state: 'staged', sha: manifest.sha, previousRelease: c.previousRelease, launcherPath: c.launcherPath,
    launcherBefore: hash(original), launcherAfter: hash(Buffer.from(updated, 'utf8')), archiveSha256,
    externalConfigSha256: c.externalConfigSha256, previousHealth: previous, at: new Date().toISOString() };
  writeReport(l.report, report, 'wx');
  return report;
}

export function switchLauncher(c) {
  const l = layout(c), report = readReport(l.report, ['staged']);
  need(digestOf(c.launcherPath) === report.launcherBefore && digestOf(l.temp) === report.launcherAfter, 'Launcher drift before switch');
  need(digestOf(c.externalConfigPath) === report.externalConfigSha256, 'External configuration changed before switch');
  renameSync(l.temp, c.launcherPath);
  writeReport(l.report, { ...report, state: 'switched', at: new Date().toISOString() });
}

export function restoreLauncher(c) {
  const l = layout(c), report = readReport(l.report, ['staged', 'switched', 'verified']);
  need(digestOf(l.backup) === report.launcherBefore, 'Launcher backup differs');
  const current = digestOf(c.launcherPath);
  need(current === report.launcherBefore || current === report.launcherAfter, 'Unexpected launcher during restore');
  if (current !== report.launcherBefore) {
    // Une copie de retour laissée par une tentative interrompue n'est reprise que si elle est l'original exact.
    if (existsSync(l.restore)) { need(digestOf(l.restore) === report.launcherBefore, 'Unexpected restore copy'); rmSync(l.restore); }
    copyFileSync(l.backup, l.restore, constants.COPYFILE_EXCL);
    renameSync(l.restore, c.launcherPath);
  }
  writeReport(l.report, { ...report, state: 'rolled-back', at: new Date().toISOString() });
}

export async function verify(c, packageRoot) {
  const l = layout(c), report = readReport(l.report, ['switched', 'verified']);
  need(digestOf(c.launcherPath) === report.launcherAfter, 'Running launcher differs from the staged one');
  for (const origin of c.origins) {
    need(await health(origin) === report.sha, `New release is not served on ${origin}`);
    await verifyServed(packageRoot, origin);
  }
  need(digestOf(c.externalConfigPath) === report.externalConfigSha256, 'External configuration changed');
  writeReport(l.report, { ...report, state: 'verified', origins: c.origins, at: new Date().toISOString() });
}

// Après un retour : lanceur d'origine, et chaque origine sert de nouveau la release relevée avant l'arrêt.
export async function verifyRestored(c) {
  const l = layout(c), report = readReport(l.report, ['rolled-back']);
  need(digestOf(c.launcherPath) === report.launcherBefore, 'Previous launcher is not in place');
  for (const origin of c.origins) {
    need(Object.hasOwn(report.previousHealth ?? {}, origin) && await health(origin) === report.previousHealth[origin],
      `Previous release is not served again on ${origin}`);
  }
}

export const MODES = { stage, verify, switch: (c) => switchLauncher(c), restore: (c) => restoreLauncher(c), restored: (c) => verifyRestored(c) };
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [mode, configPath, ...rest] = process.argv.slice(2);
    need(Object.hasOwn(MODES, mode) && configPath && !rest.length, 'Usage: install-shop.mjs stage|switch|restore|verify|restored <shop-update.json>');
    const [major, minor] = process.versions.node.split('.').map(Number);
    need(major === 22 && minor >= 12, 'Node 22.12 or newer in the Node 22 series required');
    const packageRoot = dirname(fileURLToPath(import.meta.url));
    const result = await MODES[mode](readConfig(readFileSync(configPath, 'utf8')), packageRoot);
    console.log(JSON.stringify({ mode, ok: true, ...(result?.state ? { state: result.state, sha: result.sha } : {}) }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
