import { posix } from 'node:path';

/** Exception bornée : le lien doit résoudre vers un fichier de skill tracké. */
export function isLiveSkillReference(file, line, index, tracked) {
  let start = index;
  while (start > 0 && /[A-Za-z0-9_./-]/.test(line[start - 1])) start--;
  let end = index;
  while (end < line.length && /[A-Za-z0-9_./-]/.test(line[end])) end++;
  const path = line.slice(start, end);
  const rootPath = path.startsWith('.agents/') || path.startsWith('.claude/');
  const resolved = posix.normalize(rootPath ? path : posix.join(posix.dirname(file), path));
  const skillRoot = file.match(/^(\.(?:agents|claude)\/skills\/[^/]+)\//)?.[1];
  const candidates = [resolved];
  // Les sous-documents d'un skill nomment aussi les chemins depuis sa racine.
  if (skillRoot && path.startsWith('reference' + '/')) candidates.push(posix.normalize(posix.join(skillRoot,path)));
  return candidates.some(candidate => {
    if (!['.agents/skills/', '.claude/skills/'].some(root => candidate.startsWith(root))) return false;
    if (tracked.has(candidate)) return true;
    // Répertoire cité seul ou chemin paramétré : il doit contenir un fichier suivi.
    return path.endsWith('/') && [...tracked].some(file => file.startsWith(candidate.endsWith('/') ? candidate : candidate + '/'));
  });
}
