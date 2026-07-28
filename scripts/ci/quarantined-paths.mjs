#!/usr/bin/env node
// GARDE 1 — aucun chemin quarantainé dans un fichier tracké.
//
// Les huit entrées interdites ne sont PAS écrites de mémoire : elles se
// dérivent du tag, seul dépositaire des 597 fichiers sortis du dépôt —
//   git ls-tree --name-only quarantine/2026-07-27 docs/_quarantine/
// Vérifié le 2026-07-28 : le tag rend exactement les huit constantes ci-dessous.
// Ne jamais supprimer ce tag : il est irremplaçable.
//
// MOTIF — par SEGMENT, jamais ancré sur un préfixe. Un chemin relatif
// (« ../<segment>/… ») n'a pas de préfixe : ancrer aurait rendu la moitié du
// balayage aveugle, ce qui est arrivé au premier passage.
//
// EXCEPTION MOTIVÉE, une seule : le segment « audit » est le seul des huit qui
// se prononce en langue naturelle. Nu, il matche « an audit/log page » — faux
// positif constaté dans .claude/skills/report-audit. Il exige donc un préfixe
// « docs/ » ou « _quarantine/ ». Les sept autres sont des noms propres : nus.
//
// RÉGIMES
//   1. Exempté en permanence — docs/adr/** et supabase/migrations/** : un
//      artefact immuable a le droit de citer un chemin historique. Il se
//      résout par `git show quarantine/2026-07-27:<chemin>`.
//   2. Baseline — apps/**, packages/**, supabase/functions/**,
//      supabase/tests/** : le code éditable tolère UNIQUEMENT les occurrences
//      listées dans le fichier de baseline. PLAFOND, JAMAIS PLANCHER : la
//      liste ne peut que décroître, la résorption se fait au fil des éditions.
//   3. Tolérance zéro — tout le reste (docs/**, .claude/**, racine).
//
// EXEMPTIONS NOMMÉES (jamais par numéro de ligne, qui pourrirait au premier ajout)
//   · docs/README.md — le seul document dont la FONCTION est de décrire ces
//     zones et leur résolution. L'exempter est la condition de son existence.
//   · le fichier de baseline lui-même — un scanner ne scanne pas sa propre
//     liste de tolérance, elle est faite de ces chemins par construction.

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const BASELINE = 'scripts/ci/quarantined-paths-baseline.txt';
const TAG = 'quarantine/2026-07-27';

const NAMED_EXEMPTIONS = new Set(['docs/README.md', BASELINE]);
const REGIME_1 = ['docs/adr/', 'supabase/migrations/'];
const REGIME_2 = ['apps/', 'packages/', 'supabase/functions/', 'supabase/tests/'];

// Sept entrées nues + « audit » sous préfixe. Boundary : ni lettre, ni chiffre,
// ni « _ », ni « - », ni « . » — pour que « references/ » ou « foo_archive/ »
// ne matchent pas.
const B = '(?:^|[^A-Za-z0-9_.-])';
const PATTERNS = [
  { re: new RegExp(`${B}(_archive|design-audits|reference|superpowers|workplan)/`, 'g'), kind: 'répertoire' },
  { re: new RegExp(`(?:docs|_quarantine)/(audit)/`, 'g'), kind: 'répertoire (préfixé)' },
  { re: new RegExp(`${B}(CLAUDE-old\\.md|DESIGN_POS_AND_BACKOFFICE\\.md)`, 'g'), kind: 'fichier' },
];

const git = (...args) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

function regime(file) {
  if (NAMED_EXEMPTIONS.has(file)) return 'exempt-nomme';
  if (REGIME_1.some((p) => file.startsWith(p))) return 'exempt-permanent';
  if (REGIME_2.some((p) => file.startsWith(p))) return 'baseline';
  return 'zero';
}

// La baseline est un PLAFOND COMPTÉ : « ce fichier tolère au plus N références
// à cette entrée ». Compter, plutôt que lister des numéros de ligne, tient deux
// promesses à la fois — la liste ne pourrit pas au premier ajout de ligne
// au-dessus, et un fichier déjà toléré ne peut pas en accumuler d'autres en
// silence. Format : <compte>\t<chemin>\t<entrée>.
function loadBaseline() {
  const path = join(ROOT, BASELINE);
  if (!existsSync(path)) return null;
  const map = new Map();
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const [count, file, token] = t.split('\t');
    map.set(`${file}\t${token}`, Number(count));
  }
  return map;
}

// Inclusion : on énumère ce qui vit (les fichiers trackés), on n'exclut rien de
// mort. Un répertoire supprimé disparaît de lui-même de cette liste.
const tracked = git('ls-files', '-z').split('\0').filter(Boolean);

const baseline = loadBaseline();
if (baseline === null) {
  console.error(`::error::Fichier de baseline introuvable : ${BASELINE}`);
  console.error(`Il est TRACKÉ et fait partie de la garde. S'il a été supprimé, le restaurer :`);
  console.error(`  git checkout origin/master -- ${BASELINE}`);
  process.exit(1);
}

const violations = [];   // régime zéro : toute occurrence
const counted = new Map(); // régime baseline : key -> { count, hits[] }

for (const file of tracked) {
  const r = regime(file);
  if (r === 'exempt-nomme' || r === 'exempt-permanent') continue;

  let content;
  try {
    content = readFileSync(join(ROOT, file), 'utf8');
  } catch {
    continue; // illisible ou binaire : rien à lire
  }
  if (content.includes('\0')) continue;

  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const { re, kind } of PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(lines[i])) !== null) {
        const token = m[1];
        const hit = { file, line: i + 1, token, kind, text: lines[i].trim().slice(0, 160) };
        if (r === 'baseline') {
          const key = `${file}\t${token}`;
          const e = counted.get(key) ?? { count: 0, hits: [] };
          e.count++;
          e.hits.push(hit);
          counted.set(key, e);
        } else {
          violations.push(hit);
        }
      }
    }
  }
}

// Plafond compté : au-delà de la tolérance, c'est une violation.
for (const [key, e] of counted) {
  const allowed = baseline.get(key) ?? 0;
  if (e.count > allowed) {
    for (const hit of e.hits.slice(allowed)) violations.push({ ...hit, overBaseline: allowed });
  }
}

// Ce qui a été résorbé depuis le dernier relevé. Informatif, jamais bloquant.
const resorbed = [...baseline]
  .filter(([key, allowed]) => (counted.get(key)?.count ?? 0) < allowed)
  .map(([key, allowed]) => `${key}\t(${counted.get(key)?.count ?? 0}/${allowed})`);

if (violations.length === 0) {
  console.log(`GARDE 1 — aucun chemin quarantainé hors zones exemptées. ${tracked.length} fichiers trackés balayés.`);
  if (resorbed.length) {
    console.log(`\n${resorbed.length} entrée(s) de baseline résorbée(s) depuis le dernier relevé.`);
    console.log(`La baseline est un PLAFOND : abaisse-les dans ${BASELINE}`);
    console.log(`pour qu'elles ne puissent pas revenir.`);
    for (const k of resorbed) console.log(`  - ${k.replaceAll('\t', '  ')}`);
  }
  process.exit(0);
}

console.error(`::error::GARDE 1 — ${violations.length} chemin(s) quarantainé(s) dans des fichiers trackés.`);
console.error('');
for (const v of violations) {
  const over = v.overBaseline === undefined ? '' : ` — au-dessus du plafond de baseline (${v.overBaseline})`;
  console.error(`  ${v.file}:${v.line}  [${v.kind} « ${v.token} »]${over}`);
  console.error(`    ${v.text}`);
}
console.error('');
console.error('QUOI FAIRE — dans cet ordre :');
console.error('');
console.error('  1. Ces arborescences sont sorties du dépôt. Le contenu existe toujours,');
console.error(`     uniquement dans le tag « ${TAG} ». Pour le lire :`);
console.error(`       git show ${TAG}:docs/_quarantine/<chemin>`);
console.error('');
console.error('  2. Réécris la ligne pour qu\'elle désigne quelque chose de VIVANT :');
console.error('     docs/adr/ pour une décision, docs/objectifs/ pour une intention,');
console.error('     le code lui-même pour un fait. Une ligne réécrite sort conforme ET vraie.');
console.error('');
console.error('  3. Si la référence est morte sans remplaçant, RETIRE-la. Un pointeur vers');
console.error('     un fantôme ne vaut pas mieux que pas de pointeur.');
console.error('');
console.error(`  4. N'AJOUTE PAS l'occurrence à ${BASELINE} :`);
console.error('     cette liste est un plafond gelé au 2026-07-28, elle ne peut que décroître.');
process.exit(1);
