import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { slash } from '../agents/lib.mjs';

export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function safePath(root, path) {
  const base = resolve(root);
  const target = resolve(base, path);
  const rel = relative(base, target);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw new Error('Chemin hors du périmètre autorisé.');
  let current = base;
  for (const part of ['', ...rel.split(sep)]) {
    current = join(current, part);
    try { if (lstatSync(current).isSymbolicLink()) throw new Error('Lien symbolique interdit.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return target;
}

function checkPublic(path, bytes) {
  if (path.split('/').some((part) => /^(?:\.env(?:\..*)?|\.npmrc|\.git|credentials(?:\..*)?|secrets?(?:\..*)?)$/i.test(part)) ||
      /\.(?:pem|key|p12|pfx)$/i.test(path)) throw new Error(`Fichier sensible interdit dans le bundle : ${path}`);
  const text = bytes.toString('utf8');
  if (/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----|\bsb_secret_[A-Za-z0-9_-]{10,}/.test(text))
    throw new Error(`Secret détecté dans le bundle : ${path}`);
  for (const match of text.matchAll(/\beyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g)) {
    try {
      if (JSON.parse(Buffer.from(match[1], 'base64url').toString()).role === 'service_role')
        throw new Error(`Secret service-role détecté dans le bundle : ${path}`);
    } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
  }
}

export function inventory(root, directory) {
  const base = safePath(root, directory);
  if (!lstatSync(base).isDirectory()) throw new Error('Un répertoire de bundle est requis.');
  const entries = [];
  const visit = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const path = safePath(root, join(dir, name));
      const stat = lstatSync(path);
      if (stat.isDirectory()) { visit(path); continue; }
      if (!stat.isFile()) throw new Error('Seuls les fichiers réguliers sont admis.');
      const rel = slash(relative(base, path));
      const bytes = readFileSync(path);
      checkPublic(rel, bytes);
      entries.push({ path: rel, bytes: bytes.length, sha256: digest(bytes) });
    }
  };
  visit(base);
  if (!entries.length) throw new Error('Bundle vide.');
  return entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

export function writeEvidence(root, component, name, data) {
  if (!['backoffice', 'pos', 'print-bridge'].includes(component) ||
      !['preflight.json', 'release-manifest.json'].includes(name)) throw new Error('Sortie non autorisée.');
  const path = safePath(root, `.release-manifests/${component}/${name}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  return path;
}
