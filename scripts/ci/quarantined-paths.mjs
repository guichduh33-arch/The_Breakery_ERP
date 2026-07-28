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
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
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

// Un plafond ne se resserre pas tout seul : retirer une occurrence passe en
// silence et la tolérance reste haute. Un cliquet qui ne se resserre jamais
// finit par ne plus rien tenir — d'où cet avertissement, à chaque run.
// AVERTISSEMENT, JAMAIS ÉCHEC : bloquer une réduction légitime tant que le
// fichier n'est pas à jour est la meilleure façon de faire désactiver la garde.
const slack = [...baseline]
  .map(([key, allowed]) => ({ key, allowed, real: counted.get(key)?.count ?? 0 }))
  .filter((e) => e.real < e.allowed)
  .sort((a, b) => a.key.localeCompare(b.key));

function reportSlack() {
  if (!slack.length) return;
  console.log('');
  for (const { key, allowed, real } of slack) {
    const [file, token] = key.split('\t');
    console.log(`::warning file=${file}::la baseline peut être resserrée : ${file} tolère ${allowed} référence(s) à « ${token} », le réel est ${real}`);
  }
  console.log(`${slack.length} entrée(s) de baseline au-dessus du réel. Resserre le plafond :`);
  console.log(`  node scripts/ci/quarantined-paths.mjs --update-baseline`);
  console.log(`Le drapeau ne fait que DESCENDRE les comptes — il ne peut pas servir à faire passer une violation.`);
}

// --update-baseline — le resserrement en une commande plutôt qu'une édition à
// la main. Il n'écrit QUE des comptes en baisse : si le réel dépasse le
// plafond quelque part, il refuse et renvoie à la réécriture de la ligne.
// Sans ce garde-fou, le drapeau deviendrait le bouton « faire passer la CI ».
if (process.argv.includes('--update-baseline')) {
  if (violations.length) {
    console.error(`::error::--update-baseline REFUSE : ${violations.length} occurrence(s) dépassent le plafond ou sont en tolérance zéro.`);
    console.error(`Ce drapeau ne sait que DESCENDRE un compte. Une occurrence en trop se corrige`);
    console.error(`en réécrivant la ligne fautive, jamais en relevant la baseline.`);
    console.error(`Relance sans le drapeau pour voir la liste et la marche à suivre.`);
    process.exit(1);
  }
  const path = join(ROOT, BASELINE);
  const header = readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim().startsWith('#'))
    .map((l) => (/^# Dernier resserrement :/.test(l) ? `# Dernier resserrement : ${new Date().toISOString().slice(0, 10)}` : l));
  const rows = [...counted.entries()]
    .filter(([, e]) => e.count > 0)
    // par CHEMIN, pas par compte : la liste se relit fichier par fichier, et un
    // resserrement produit un diff d'une ligne au lieu d'un réordonnancement.
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, e]) => `${e.count}\t${key}`);
  writeFileSync(path, `${header.join('\n')}\n${rows.join('\n')}\n`, 'utf8');
  const before = [...baseline.values()].reduce((a, b) => a + b, 0);
  const after = [...counted.values()].reduce((a, e) => a + e.count, 0);
  console.log(`Baseline resserrée : ${baseline.size} → ${rows.length} entrée(s), ${before} → ${after} occurrence(s) tolérée(s).`);
  console.log(`Commite ${BASELINE}.`);
  process.exit(0);
}

if (violations.length === 0) {
  console.log(`GARDE 1 — aucun chemin quarantainé hors zones exemptées. ${tracked.length} fichiers trackés balayés.`);
  reportSlack();
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
console.error('     cette liste est un plafond gelé, elle ne peut que décroître.');
reportSlack();
process.exit(1);
