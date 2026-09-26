import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const normalized = (text) => text.replace(/\r\n/g, '\n');
export const read = (path) => normalized(readFileSync(path, 'utf8'));
export const slash = (path) => path.split(sep).join('/');
export function git(args, cwd = ROOT) {
  return execFileSync('git', ['-c', `safe.directory=${slash(resolve(cwd))}`, ...args], {
    cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
  }).trimEnd();
}
export function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Lien non géré : ${path}`);
    return entry.isDirectory() ? filesUnder(path) : [path];
  }).sort();
}
export function inside(root, input) {
  const path = resolve(root, input);
  const rel = relative(root, path);
  if (rel === '..' || rel.startsWith(`..${sep}`) || resolve(root) === path || /^[A-Za-z]:/.test(rel)) {
    throw new Error('Un chemin relatif interne au dépôt est requis.');
  }
  return path;
}
export function isMain(url) {
  return process.argv[1] && fileURLToPath(url) === resolve(process.argv[1]);
}
