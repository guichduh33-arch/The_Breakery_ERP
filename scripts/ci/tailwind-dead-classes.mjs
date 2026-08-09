#!/usr/bin/env node
// GARDE 3 — aucune classe utilitaire de couleur qui ne rende rien.
//
// Deux défauts, une seule cause : Tailwind supprime SILENCIEUSEMENT une
// déclaration qu'il ne sait pas produire. Rien ne casse, rien n'avertit — la
// couleur n'apparaît simplement jamais. C'est passé deux fois sur ce dépôt :
//   · `bg-danger/15` — un modificateur alpha sur une couleur déclarée `var(--x)`
//     NUE. Tailwind ne peut pas y injecter un canal alpha, la règle disparaît.
//     Seule la famille `cat-*` est déclarée `rgb(var(--x) / <alpha-value>)`.
//   · `bg-bg-card`, `ring-accent-primary` — un nom qui n'est dans aucune famille.
//
// Diagnostiqué en commentaire dans un fichier le 2026-08-08, recopié 54 fois
// ailleurs le lendemain. Un commentaire ne tient pas un invariant ; une garde si.
//
// LA VÉRITÉ VIENT DU PRESET, jamais d'une liste écrite ici. On lit les familles
// de couleurs dans packages/ui/tailwind-preset.ts et on s'en sert pour juger.
// Ajouter un token au preset suffit donc à le rendre légitime : rien à mettre à
// jour ici, et aucune liste à faire pourrir.
//
// CE QUI N'EST PAS VÉRIFIÉ, volontairement :
//   · un nom qui n'appartient à AUCUNE famille connue (`ring-accent-primary`
//     après coup) — impossible à distinguer d'un utilitaire non-couleur
//     (`ring-2`, `text-sm`, `border-b`) sans réimplémenter Tailwind. La garde
//     attrape la clé inconnue DANS une famille connue, pas la famille inventée.
//   · les clés numériques (`red-500`, `blue-50`) : la palette Tailwind par
//     défaut survit à `extend`, elles sont donc légitimes, alpha compris.
//   · les lignes de commentaire : une explication cite le défaut, elle ne le
//     commet pas.
//
// RÉGIME — baseline sur apps/** et packages/**. PLAFOND COMPTÉ, JAMAIS PLANCHER,
// exactement comme la garde 1 : la liste ne peut que décroître.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const BASELINE = 'scripts/ci/tailwind-dead-classes-baseline.txt';
const PRESET = 'packages/ui/tailwind-preset.ts';

const SCANNED = ['apps/', 'packages/'];
const EXT = /\.(tsx|ts)$/;

// Préfixes d'utilitaires qui prennent une couleur.
const PREFIX = '(?:bg|text|border|ring|outline|divide|fill|stroke|accent|caret|placeholder|decoration|shadow|from|via|to)';

const git = (...args) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/**
 * Extrait le bloc `colors: { … }` du preset et en tire, par famille, ses clés
 * et la capacité de chacune à porter un alpha (`<alpha-value>` dans la valeur).
 * Parseur volontairement étroit : il connaît la forme de CE fichier. S'il ne
 * trouve rien, la garde ÉCHOUE — une garde qui ne sait plus lire sa source doit
 * se taire bruyamment, jamais passer en silence.
 */
function readFamilies() {
  const src = readFileSync(join(ROOT, PRESET), 'utf8');
  const start = src.indexOf('colors: {');
  if (start === -1) return null;
  let depth = 0, end = -1;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) return null;
  const body = src.slice(src.indexOf('{', start) + 1, end);

  const families = new Map(); // nom -> { keys: Map<clé, alphaOk>, scalarAlphaOk: bool|null }
  const KEY = "(?:([A-Za-z_$][\\w-]*)|'([^']+)'|\"([^\"]+)\"|(\\d+))";
  const re = new RegExp(`${KEY}\\s*:\\s*(\\{|'[^']*'|\`[^\`]*\`)`, 'g');
  let m;
  let cursor = 0;
  while ((m = re.exec(body)) !== null) {
    if (m.index < cursor) continue;
    const name = m[1] ?? m[2] ?? m[3] ?? m[4];
    const open = m[5];
    if (open !== '{') {
      // Famille scalaire : `cream: 'var(--cream)'`.
      families.set(name, { keys: null, scalarAlphaOk: open.includes('<alpha-value>') });
      cursor = re.lastIndex;
      continue;
    }
    // Groupe : on isole son corps par équilibrage d'accolades.
    let d = 0, close = -1;
    for (let i = m.index + m[0].length - 1; i < body.length; i++) {
      if (body[i] === '{') d++;
      else if (body[i] === '}') { d--; if (d === 0) { close = i; break; } }
    }
    if (close === -1) continue;
    const inner = body.slice(m.index + m[0].length, close);
    const keys = new Map();
    const kre = new RegExp(`${KEY}\\s*:\\s*('[^']*'|\`[^\`]*\`)`, 'g');
    let km;
    while ((km = kre.exec(inner)) !== null) {
      const kname = km[1] ?? km[2] ?? km[3] ?? km[4];
      keys.set(kname, km[5].includes('<alpha-value>'));
    }
    families.set(name, { keys, scalarAlphaOk: null });
    cursor = close;
    re.lastIndex = close;
  }
  return families.size > 0 ? families : null;
}

const families = readFamilies();
if (families === null) {
  console.error(`::error::GARDE 3 — impossible de lire les familles de couleurs dans ${PRESET}.`);
  console.error(`La garde tire sa vérité de ce fichier ; si sa forme a changé, ADAPTE LE PARSEUR.`);
  console.error(`Ne désactive pas la garde : c'est elle qui tient l'invariant.`);
  process.exit(1);
}

const FAMILY_RE = new RegExp(
  `\\b${PREFIX}-(${[...families.keys()].map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})` +
  `(?:-([A-Za-z0-9][\\w-]*))?(?:\\/(\\d+))?\\b`,
  'g',
);

const isNumericKey = (k) => k !== undefined && /^\d+$/.test(k);
const isComment = (l) => /^\s*(\/\/|\*|\/\*)/.test(l);

/** @returns {null | 'cle-inconnue' | 'alpha-mort'} */
function judge(family, key, alpha) {
  const fam = families.get(family);
  if (fam === undefined) return null;
  // Palette Tailwind par défaut : `extend` ne la remplace pas.
  if (isNumericKey(key) && fam.keys !== null && !fam.keys.has(key)) return null;

  let alphaOk;
  if (fam.keys === null) {
    if (key !== undefined) return 'cle-inconnue';
    alphaOk = fam.scalarAlphaOk;
  } else {
    const k = key ?? 'DEFAULT';
    if (!fam.keys.has(k)) return 'cle-inconnue';
    alphaOk = fam.keys.get(k);
  }
  if (alpha !== undefined && !alphaOk) return 'alpha-mort';
  return null;
}

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

const baseline = loadBaseline();
if (baseline === null) {
  console.error(`::error::Fichier de baseline introuvable : ${BASELINE}`);
  console.error(`Il est TRACKÉ et fait partie de la garde. S'il a été supprimé, le restaurer :`);
  console.error(`  git checkout origin/master -- ${BASELINE}`);
  process.exit(1);
}

const tracked = git('ls-files', '-z').split('\0').filter(Boolean);
const counted = new Map(); // key -> { count, hits[] }
let scanned = 0;

for (const file of tracked) {
  if (file === BASELINE) continue;
  if (!SCANNED.some((p) => file.startsWith(p)) || !EXT.test(file)) continue;
  let content;
  try { content = readFileSync(join(ROOT, file), 'utf8'); } catch { continue; }
  scanned++;
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (isComment(lines[i])) continue;
    FAMILY_RE.lastIndex = 0;
    let m;
    while ((m = FAMILY_RE.exec(lines[i])) !== null) {
      const verdict = judge(m[1], m[2], m[3]);
      if (verdict === null) continue;
      const token = m[0].replace(/^[a-z-]*:/, '');
      const key = `${file}\t${token}`;
      const e = counted.get(key) ?? { count: 0, hits: [] };
      e.count++;
      e.hits.push({ file, line: i + 1, token, verdict, text: lines[i].trim().slice(0, 160) });
      counted.set(key, e);
    }
  }
}

const violations = [];
for (const [key, e] of counted) {
  const allowed = baseline.get(key) ?? 0;
  if (e.count > allowed) {
    for (const hit of e.hits.slice(allowed)) violations.push({ ...hit, overBaseline: allowed });
  }
}

const slack = [...baseline]
  .map(([key, allowed]) => ({ key, allowed, real: counted.get(key)?.count ?? 0 }))
  .filter((e) => e.real < e.allowed)
  .sort((a, b) => a.key.localeCompare(b.key));

// AVERTISSEMENT, JAMAIS ÉCHEC — bloquer une réduction légitime tant que le
// fichier n'est pas à jour est la meilleure façon de faire désactiver la garde.
function reportSlack() {
  if (!slack.length) return;
  console.log('');
  for (const { key, allowed, real } of slack) {
    const [file, token] = key.split('\t');
    console.log(`::warning file=${file}::la baseline peut être resserrée : ${file} tolère ${allowed} « ${token} », le réel est ${real}`);
  }
  console.log(`${slack.length} entrée(s) de baseline au-dessus du réel. Resserre le plafond :`);
  console.log(`  node scripts/ci/tailwind-dead-classes.mjs --update-baseline`);
  console.log(`Le drapeau ne fait que DESCENDRE les comptes — il ne peut pas servir à faire passer une violation.`);
}

if (process.argv.includes('--update-baseline')) {
  if (violations.length) {
    console.error(`::error::--update-baseline REFUSE : ${violations.length} occurrence(s) au-dessus du plafond.`);
    console.error(`Ce drapeau ne sait que DESCENDRE un compte. Une classe morte se corrige en`);
    console.error(`réécrivant la ligne, jamais en relevant la baseline.`);
    process.exit(1);
  }
  const path = join(ROOT, BASELINE);
  const header = readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim().startsWith('#'))
    .map((l) => (/^# Dernier resserrement :/.test(l) ? `# Dernier resserrement : ${new Date().toISOString().slice(0, 10)}` : l));
  const rows = [...counted.entries()]
    .filter(([, e]) => e.count > 0)
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
  const tolerated = [...counted.values()].reduce((a, e) => a + e.count, 0);
  console.log(`GARDE 3 — aucune classe de couleur morte hors baseline. ${scanned} fichiers balayés, ${families.size} familles lues dans le preset, ${tolerated} occurrence(s) héritée(s) tolérée(s).`);
  reportSlack();
  process.exit(0);
}

console.error(`::error::GARDE 3 — ${violations.length} classe(s) de couleur qui ne rendent rien.`);
console.error('');
for (const v of violations) {
  const why = v.verdict === 'alpha-mort'
    ? 'modificateur alpha sur une couleur déclarée `var()` nue — Tailwind supprime la déclaration'
    : 'cette clé n\'existe dans aucune famille du preset — la classe n\'est jamais générée';
  console.error(`  ${v.file}:${v.line}  « ${v.token} »  (plafond ${v.overBaseline})`);
  console.error(`    ${why}`);
  console.error(`    ${v.text}`);
}
console.error('');
console.error('QUOI FAIRE — dans cet ordre :');
console.error('');
console.error('  1. ALPHA MORT sur un FOND : prends le token `-soft` de la même famille');
console.error('     (`bg-danger/5` → `bg-danger-soft`). Ils existent précisément pour ça.');
console.error('');
console.error('  2. ALPHA MORT sur une BORDURE ou un ANNEAU : retire le modificateur');
console.error('     (`border-danger/40` → `border-danger`). L\'alpha ne rendait déjà rien ;');
console.error('     le retirer ne change pas le pixel, il rend le code honnête.');
console.error('');
console.error('  3. CLÉ INCONNUE : ouvre packages/ui/tailwind-preset.ts et prends le nom réel.');
console.error('     Si le token MANQUE vraiment au système, ajoute-le au preset ET aux deux');
console.error('     thèmes de packages/ui/src/tokens/colors.css — la garde l\'acceptera seule.');
console.error('');
console.error('  4. Besoin d\'un vrai fond translucide ? Seule la famille `cat-*` le permet');
console.error('     (déclarée en triplet RGB). Une teinte catégorielle reste réservée à');
console.error('     l\'identité d\'une catégorie de produit — pas à un état.');
console.error('');
console.error(`  5. N'AJOUTE PAS l'occurrence à ${BASELINE} :`);
console.error('     cette liste est un plafond gelé, elle ne peut que décroître.');
reportSlack();
process.exit(1);
