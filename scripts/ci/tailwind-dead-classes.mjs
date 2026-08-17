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
// L'ANGLE MORT, ET CE QU'ON EN FAIT (2026-08-18).
//
// La garde savait juger une clé inconnue DANS une famille connue
// (`bg-bg-card`), pas une FAMILLE inventée : `bg-warn` n'a jamais été examiné,
// parce que `warn` n'est pas une famille du preset et que la regex principale
// exige `PREFIX-FAMILLE`. Impossible à fermer dans le cas général — on ne
// distingue pas `text-warn` de `text-sm` sans réimplémenter Tailwind.
//
// Ce qu'on PEUT fermer, c'est le cas nommé : le vocabulaire shadcn/ui. Ces noms
// arrivent par copier-coller depuis un exemple de la doc ou depuis un
// générateur, ils désignent des familles que ce dépôt n'a jamais déclarées, et
// ils sont donc TOUJOURS morts. La liste noire ci-dessous est fermée et
// explicite : elle n'essaie pas de deviner, elle refuse treize noms connus.
//
// Elle est consultée APRÈS la regex de familles et sur des positions
// disjointes : `bg-input` est refusé, `bg-bg-input` (la vraie classe du token
// `--bg-input`) ne l'est pas, parce que le lookbehind interdit qu'un candidat
// soit précédé d'un tiret. Même chose pour `text-primary` (mort) contre
// `text-text-primary` (vivant).
//
// CE QUI N'EST TOUJOURS PAS VÉRIFIÉ, volontairement :
//   · une famille inventée HORS liste noire (`ring-accent-primary` après coup) —
//     indistinguable d'un utilitaire non-couleur (`ring-2`, `text-sm`,
//     `border-b`) sans réimplémenter Tailwind.
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

// LISTE NOIRE shadcn/ui — treize noms de famille que ce dépôt n'a jamais
// déclarés. Contrôlés au démarrage contre le preset : si l'un d'eux DEVENAIT
// une vraie famille, la garde s'arrête au lieu de crier au loup.
const SHADCN_FAMILIES = [
  'muted-foreground', 'border-input', 'background', 'destructive', 'foreground',
  'secondary', 'popover', 'primary', 'accent', 'card', 'input', 'warn', 'ring',
];

for (const name of SHADCN_FAMILIES) {
  if (families.has(name)) {
    console.error(`::error::GARDE 3 — « ${name} » est sur la liste noire shadcn ET déclaré comme famille dans ${PRESET}.`);
    console.error(`Les deux ne peuvent pas être vrais. Retire le nom de SHADCN_FAMILIES, ou retire la famille du preset.`);
    process.exit(1);
  }
}

// `(?<![\w-])` : un candidat précédé d'un tiret est un MORCEAU d'une classe
// légitime — `bg-input` dans `bg-bg-input`, `text-primary` dans
// `text-text-primary`. Sans ce lookbehind la liste noire condamnerait les deux
// classes les plus répandues du dépôt. `(?![\w-])` ferme l'autre bout : on ne
// veut pas de `bg-card-foo`, qui n'est pas le nom shadcn.
// Les noms sont triés du plus LONG au plus court pour que l'alternance préfère
// `border-input` à `input` et `muted-foreground` à un préfixe plus court.
const SHADCN_RE = new RegExp(
  `(?<![\\w-])${PREFIX}-(${[...SHADCN_FAMILIES]
    .sort((a, b) => b.length - a.length)
    .map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')})(?:\\/(\\d+))?(?![\\w-])`,
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
    const record = (token, verdict) => {
      const key = `${file}\t${token.replace(/^[a-z-]*:/, '')}`;
      const e = counted.get(key) ?? { count: 0, hits: [] };
      e.count++;
      e.hits.push({
        file, line: i + 1, token: token.replace(/^[a-z-]*:/, ''), verdict,
        text: lines[i].trim().slice(0, 160),
      });
      counted.set(key, e);
    };
    FAMILY_RE.lastIndex = 0;
    let m;
    while ((m = FAMILY_RE.exec(lines[i])) !== null) {
      const verdict = judge(m[1], m[2], m[3]);
      if (verdict === null) continue;
      record(m[0], verdict);
    }
    // Liste noire shadcn — positions disjointes de FAMILY_RE par construction :
    // le segment qui suit le préfixe est soit une famille du preset, soit un nom
    // de la liste noire, jamais les deux (vérifié au démarrage).
    SHADCN_RE.lastIndex = 0;
    while ((m = SHADCN_RE.exec(lines[i])) !== null) record(m[0], 'famille-shadcn');
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
    : v.verdict === 'famille-shadcn'
      ? 'nom de famille shadcn/ui — ce dépôt ne l\'a jamais déclaré, la classe n\'est jamais générée'
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
console.error('  3. FAMILLE SHADCN (`bg-background`, `text-muted-foreground`, `ring-ring`…) :');
console.error('     ce vocabulaire vient d\'un exemple de doc, pas de ce dépôt. Traduis vers le');
console.error('     token du système — fond `bg-bg-elevated` / `bg-surface-N`, texte');
console.error('     `text-text-muted`, bordure `border-border-subtle`, anneau `outline-gold`.');
console.error('     N\'ajoute JAMAIS le nom au preset pour faire taire la garde.');
console.error('');
console.error('  4. CLÉ INCONNUE : ouvre packages/ui/tailwind-preset.ts et prends le nom réel.');
console.error('     Si le token MANQUE vraiment au système, ajoute-le au preset ET aux deux');
console.error('     thèmes de packages/ui/src/tokens/colors.css — la garde l\'acceptera seule.');
console.error('');
console.error('  4. Besoin d\'un vrai fond translucide ? Seule la famille `cat-*` le permet');
console.error('     (déclarée en triplet RGB). Une teinte catégorielle reste réservée à');
console.error('     l\'identité d\'une catégorie de produit — pas à un état.');
console.error('');
console.error(`  6. N'AJOUTE PAS l'occurrence à ${BASELINE} :`);
console.error('     cette liste est un plafond gelé, elle ne peut que décroître.');
reportSlack();
process.exit(1);
