// Vérification autonome : aucune dépendance npm, aucun appel métier.
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PRODUCTION_REF = 'yjhhhmjgsmyzyymvixot';
export const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function regularPath(root, name) {
  if (typeof name !== 'string' || !name || name.includes('\\') || name.split('/').some((p) => !p || p === '.' || p === '..' || p.includes(':')))
    throw new Error('Invalid package path');
  const base = resolve(root), target = resolve(base, name), rel = relative(base, target);
  if (isAbsolute(rel) || rel.startsWith(`..${sep}`)) throw new Error('Invalid package path');
  let current = base;
  for (const part of name.split('/')) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error('Package links are forbidden');
  }
  if (!lstatSync(target).isFile()) throw new Error('Regular file required');
  return target;
}
export function files(root, prefix = '') {
  const result = [];
  for (const item of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isSymbolicLink()) throw new Error('Package links are forbidden');
    if (item.isDirectory()) result.push(...files(root, path));
    else if (item.isFile()) result.push(path);
    else throw new Error('Regular file required');
  }
  return result.sort();
}
export function verifyShop(root, expectedSha) {
  const manifest = JSON.parse(readFileSync(regularPath(root, 'release.json'), 'utf8'));
  if (manifest.version !== 1 || typeof manifest.installable !== 'boolean' || manifest.projectRef !== PRODUCTION_REF || !/^[a-f0-9]{40}$/.test(manifest.sha)
    || (expectedSha && manifest.sha !== expectedSha) || manifest.platform !== 'win32-x64'
    || !Array.isArray(manifest.files) || !manifest.files.length) throw new Error('Wrong shop release identity');
  const actual = files(root).filter((path) => path !== 'release.json');
  const expected = manifest.files.map((item) => item.path).sort();
  if (new Set(expected.map((p) => p.toLowerCase())).size !== expected.length || JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error('Package inventory mismatch');
  for (const item of manifest.files) {
    const bytes = readFileSync(regularPath(root, item.path));
    if (bytes.length !== item.bytes || hash(bytes) !== item.sha256) throw new Error('Package integrity mismatch');
  }
  const entry = 'payload/apps/print-bridge/dist/server.js';
  regularPath(root, entry);
  const bridge = JSON.parse(readFileSync(regularPath(root, 'payload/apps/print-bridge/package.json'), 'utf8'));
  if (bridge.type !== 'module') throw new Error('Bridge ESM package required');
  regularPath(root, 'payload/apps/pos/dist/index.html');
  const refs = new Set();
  for (const path of actual.filter((p) => p.startsWith('payload/apps/pos/dist/') && /\.(js|html)$/.test(p))) {
    const text = readFileSync(regularPath(root, path), 'utf8');
    for (const match of text.matchAll(/([a-z0-9]{20})\.supabase\.co/g)) refs.add(match[1]);
  }
  if (refs.size !== 1 || !refs.has(PRODUCTION_REF)) throw new Error('POS bundle target mismatch');
  return manifest;
}
export function requireInstallable(manifest) {
  if (!manifest.installable || !Array.isArray(manifest.proofs)
    || !['ci.yml', 'pgtap-pr.yml'].every((name) => manifest.proofs.some((p) => p.workflow === name
      && p.sha === manifest.sha && Number.isSafeInteger(p.runId) && p.runId > 0
      && Number.isSafeInteger(p.runAttempt) && p.runAttempt > 0))) throw new Error('Verified production release proofs required; validation packages cannot be installed');
}
export async function verifyServed(root, origin) {
  const manifest = verifyShop(root);
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error('Exact HTTPS shop origin required');
  // Lire les octets servis ; ni impression ni transaction ni modification de shift.
  for (const item of manifest.files.filter((p) => p.path.startsWith('payload/apps/pos/dist/'))) {
    const path = item.path.slice('payload/apps/pos/dist/'.length);
    const response = await fetch(new URL(path, url), { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!response.ok || hash(Buffer.from(await response.arrayBuffer())) !== item.sha256) throw new Error('Served POS differs from release');
  }
  const health = await fetch(new URL('/health', url), { redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!health.ok || (await health.json()).release_sha !== manifest.sha) throw new Error('Bridge release identity mismatch');
}
export function verifyInstalled(root, destination) {
  const manifest = verifyShop(root);
  const payload = manifest.files.filter((item) => item.path.startsWith('payload/'));
  for (const item of payload) {
    const bytes = readFileSync(regularPath(destination, item.path.slice('payload/'.length)));
    if (bytes.length !== item.bytes || hash(bytes) !== item.sha256) throw new Error('Installed payload differs from release');
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [major, minor] = process.versions.node.split('.').map(Number);
    if (major !== 22 || minor < 12) throw new Error('Node 22.12 or newer in the Node 22 series required');
    const root = dirname(fileURLToPath(import.meta.url));
    const manifest = verifyShop(root, process.env.RELEASE_SHA);
    if (process.argv[2] === '--install' && process.argv.length === 3) requireInstallable(manifest);
    else if (process.argv[2] === '--served' && process.argv[3]) await verifyServed(root, process.argv[3]);
    else if (process.argv[2] === '--installed' && process.argv[3]) verifyInstalled(root, process.argv[3]);
    else if (process.argv.length > 2) throw new Error('Invalid verification arguments');
    console.log(JSON.stringify({ verified: true, sha: manifest.sha, projectRef: manifest.projectRef }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
