#!/usr/bin/env node
// GARDE 2 — tout lien relatif d'un .md tracké doit résoudre.
//
// Elle n'énumère aucun chemin mort : elle vérifie que la cible existe. C'est
// pour ça qu'elle attrape TOUS les liens cassés, présents et futurs, sans
// liste à maintenir — là où une liste de noms legacy pourrit dès qu'un
// nouveau nom apparaît.
//
// Elle aurait attrapé les 4 liens morts de docs/README.md et celui de
// docs/objectifs/PRODUCTION.md, trouvés à la main pendant l'audit.
//
// PÉRIMÈTRE — inclusion : les .md TRACKÉS. Un fichier supprimé disparaît de
// lui-même de git ls-files ; rien n'est exclu nommément, aucune zone morte
// n'est citée.
//
// EXEMPTION, une seule : docs/adr/** — un ADR est immuable. Il a le droit de
// pointer vers un document sorti du dépôt depuis ; la résolution passe par
//   git show quarantine/2026-07-27:<chemin>
//
// Ce qui n'est PAS vérifié, volontairement : les URL absolues (http, https,
// mailto, tel) — la CI n'a pas à dépendre du réseau, et un lien externe mort
// n'est pas une erreur du dépôt. Les ancres pures (#section) non plus : elles
// dépendent du rendu markdown, pas du système de fichiers.

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const EXEMPT = ['docs/adr/'];
const TAG = 'quarantine/2026-07-27';

const git = (...args) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

// [texte](cible) et [texte](<cible>) — la forme référence [x]: cible est
// traitée par la seconde passe.
const INLINE = /\[[^\]]*\]\(\s*<?([^)>\s]+)>?(?:\s+["'][^"']*["'])?\s*\)/g;
const REFDEF = /^\s{0,3}\[[^\]]+\]:\s*<?([^\s>]+)>?/;

function isExternal(target) {
  return (
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target) || // http:, https:, mailto:, tel:, data:
    target.startsWith('//') ||
    target.startsWith('#')
  );
}

const files = git('ls-files', '-z', '*.md', '**/*.md')
  .split('\0')
  .filter(Boolean)
  .filter((f) => !EXEMPT.some((p) => f.startsWith(p)));

const broken = [];
let checked = 0;

for (const file of files) {
  let content;
  try {
    content = readFileSync(join(ROOT, file), 'utf8');
  } catch {
    continue;
  }
  const lines = content.split(/\r?\n/);
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue; // un bloc de code montre des chemins, il n'en promet aucun

    const targets = [];
    INLINE.lastIndex = 0;
    let m;
    while ((m = INLINE.exec(line)) !== null) targets.push(m[1]);
    const rd = REFDEF.exec(line);
    if (rd) targets.push(rd[1]);

    for (const raw of targets) {
      if (isExternal(raw)) continue;
      if (raw.startsWith('/')) continue; // absolu au site, pas un chemin du dépôt
      const target = decodeURIComponent(raw.split('#')[0]).trim();
      if (!target) continue; // ancre pure
      checked++;
      const abs = resolve(join(ROOT, dirname(file)), target);
      if (!existsSync(abs)) {
        broken.push({ file, line: i + 1, target: raw, resolved: relative(ROOT, abs).replaceAll('\\', '/') });
      }
    }
  }
}

if (broken.length === 0) {
  console.log(`GARDE 2 — ${checked} lien(s) relatif(s) vérifié(s) dans ${files.length} fichiers .md, tous résolvent.`);
  process.exit(0);
}

console.error(`::error::GARDE 2 — ${broken.length} lien(s) relatif(s) ne résolvent pas.`);
console.error('');
for (const b of broken) {
  console.error(`  ${b.file}:${b.line}`);
  console.error(`    lien   : ${b.target}`);
  console.error(`    cible  : ${b.resolved}  (n'existe pas)`);
}
console.error('');
console.error('QUOI FAIRE — dans cet ordre :');
console.error('');
console.error('  1. Faute de frappe ou fichier déplacé ? Corrige la cible.');
console.error('');
console.error('  2. La cible est-elle sortie du dépôt ? Elle vit alors dans le tag :');
console.error(`       git show ${TAG}:docs/_quarantine/<chemin>`);
console.error('     Un lien ne peut pas pointer vers le tag. Réécris la ligne pour');
console.error('     désigner ce qui vit — docs/adr/ pour une décision, docs/objectifs/');
console.error('     pour une intention, le code pour un fait.');
console.error('');
console.error('  3. Plus de remplaçant ? RETIRE le lien et garde le texte nu. Un lien');
console.error('     qui ne mène nulle part vaut moins qu\'une phrase honnête.');
console.error('');
console.error('  Un chemin cité en PROSE (sans crochets) est invisible à cette garde :');
console.error('  c\'est la garde 1 qui l\'attrape, et seulement s\'il est quarantainé.');
process.exit(1);
