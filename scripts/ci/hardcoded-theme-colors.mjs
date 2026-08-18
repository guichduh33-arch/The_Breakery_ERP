#!/usr/bin/env node
// GARDE 4 — aucune couleur du thème recopiée en dur dans le Backoffice.
//
// Le défaut : un token du thème réécrit en littéral hexadécimal. Rien ne casse,
// rien n'avertit — la couleur est même EXACTE le jour où on l'écrit. Elle ment
// le jour où le thème bouge. C'est déjà arrivé deux fois sur ce dépôt :
//   · l'ivoire chaud retiré le 2026-08-05 a laissé des grilles de graphe beiges
//     sur des cartes devenues blanches ;
//   · `--gold-base` assombri au lot 8 a laissé des ors clairs sous 4,5:1.
//
// LA VÉRITÉ VIENT DES TOKENS, jamais d'une liste écrite ici. On lit les blocs de
// thème de packages/ui/src/tokens/{colors,luxe-dark}.css et on s'en sert pour
// juger. Ajouter, retirer ou changer un token suffit donc à déplacer le verdict :
// rien à mettre à jour ici, et aucune liste à faire pourrir.
//
// PÉRIMÈTRE — `apps/backoffice/src/` ET `packages/ui/src/` (étendu le
// 2026-08-18). Le halo de focus, dont la dérive est le deuxième défaut cité en
// tête de ce fichier, vit dans `packages/ui/src/tokens/elevation.css` : la garde
// née pour cette classe de défaut ne balayait pas le fichier qui l'avait
// produite. `apps/pos` reste dehors : un hex du thème CLAIR recopié là n'est pas
// la même faute (le POS a sa propre palette, la valeur y est un étranger, pas un
// doublon), alors que `packages/ui` sert les DEUX thèmes.
//
// DEUX TABLES, PAS UNE — les tokens du POS et ceux du back-office vivent dans le
// même fichier. Comparer tout à tout ferait crier au loup sur les littéraux
// légitimes de l'autre thème. On classe donc chaque bloc de thème par son
// sélecteur et on juge :
//   · `apps/backoffice/src/` → table BACK-OFFICE (régime d'origine, baseline
//     inchangée) ;
//   · un fichier CSS de `packages/ui/src/` → la table du BLOC où vit la ligne
//     (`.theme-backoffice` vs `:root` / `.dark` / `.theme-pos`) ; hors bloc de
//     thème, l'union ;
//   · un fichier TS/TSX de `packages/ui/src/` → l'UNION : un composant partagé
//     rend sous les deux thèmes, y recopier l'un ou l'autre est la même faute.
// Les deux fichiers de DÉFINITION sont exclus du balayage : la valeur y est la
// déclaration, pas sa copie.
//
// CE QUI N'EST PAS VÉRIFIÉ, volontairement :
//   · les couleurs qui n'appartiennent à AUCUN token — un hex inventé est un
//     choix de data-viz possiblement légitime (cf. les rampes de coût), pas une
//     recopie. La garde attrape le DOUBLON, jamais la couleur inconnue.
//   · les COMMENTAIRES — une explication cite le défaut, elle ne le commet pas.
//     Contrairement à la garde 3, qui ne reconnaît qu'une ligne commençant par
//     `//` ou `*`, celle-ci retire les commentaires par balayage du fichier :
//     commentaire de FIN DE LIGNE, bloc `/* … */` sur plusieurs lignes, et
//     commentaire JSX `{/* … */}` — qui est le cas que la garde 3 rate.
//     Les chaînes sont préservées : c'est là que les hex vivent.
//
// RÉGIME — baseline sur apps/backoffice/src. PLAFOND COMPTÉ, JAMAIS PLANCHER,
// exactement comme les gardes 1 et 3 : la liste ne peut que décroître.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const BASELINE = 'scripts/ci/hardcoded-theme-colors-baseline.txt';
/** Les fichiers où les tokens sont DÉFINIS — source de vérité, jamais balayés. */
const TOKEN_SOURCES = [
  'packages/ui/src/tokens/colors.css',
  'packages/ui/src/tokens/luxe-dark.css',
];

const SCANNED = ['apps/backoffice/src/', 'packages/ui/src/'];
const EXT = /\.(tsx|ts|css)$/;

const git = (...args) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** `#abc` / `#aabbcc` / `#aabbccdd` → `#aabbcc`. L'alpha ne sauve pas une
 *  recopie : c'est la même teinte du thème, écrite à la main. */
function normalizeHex(raw) {
  const h = raw.slice(1).toLowerCase();
  if (h.length === 3 || h.length === 4) {
    return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
  }
  return `#${h.slice(0, 6)}`;
}

const HEX_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g;
/**
 * `rgb(r, g, b)` / `rgba(r g b / a)` — la MÊME recopie, écrite autrement. Sans
 * cette forme la garde ne voyait pas le cas qui a motivé son extension : le halo
 * de focus du POS était `rgba(211, 171, 92, 0.40)`, c'est-à-dire --gold-base
 * (#d3ab5c) recopié en décimal. L'alpha ne sauve pas plus une recopie ici qu'en
 * hexadécimal : c'est la même teinte du thème. Une composante en `%` ou une
 * fonction imbriquée (`rgb(var(--x) / .4)`) n'est pas un littéral et ne matche
 * pas — c'est voulu, elle CONSOMME le token.
 */
const RGB_RE = /\brgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/][^)]*)?\)/g;

function rgbToHex(m) {
  return `#${[m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`;
}

/** Toutes les couleurs LITTÉRALES d'un texte, normalisées en `#rrggbb`. */
function colorsIn(text) {
  const out = [];
  HEX_RE.lastIndex = 0;
  for (const m of text.matchAll(HEX_RE)) out.push({ hex: normalizeHex(m[0]), literal: m[0] });
  RGB_RE.lastIndex = 0;
  for (const m of text.matchAll(RGB_RE)) out.push({ hex: rgbToHex(m), literal: m[0] });
  return out;
}

/** Découpe un CSS en blocs de premier niveau `{ sélecteur, from, to }`. */
function cssBlocks(css) {
  const out = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open === -1) break;
    const selector = (css.slice(i, open).trim().split(/\n\s*\n/).pop() ?? '').trim();
    let depth = 0, close = css.length - 1;
    for (let j = open; j < css.length; j++) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') { depth--; if (depth === 0) { close = j; break; } }
    }
    out.push({ selector, from: open + 1, to: close });
    i = close + 1;
  }
  return out;
}

/** `backoffice` | `pos` | null (bloc qui n'est pas un thème : @media, @keyframes…). */
function themeOfSelector(selector) {
  if (/\.theme-backoffice/.test(selector)) return 'backoffice';
  if (/(^|[,\s]):root\b|\.dark\b|\.theme-pos\b/.test(selector)) return 'pos';
  return null;
}

/**
 * Lit les DEUX fichiers de tokens, classe chaque bloc par son sélecteur et en
 * tire une table `hex normalisé → [tokens]` PAR THÈME. Parseur volontairement
 * étroit : il connaît la forme de ces fichiers. S'il ne sait plus les lire — un
 * bloc de thème non classé, une table vide — la garde ÉCHOUE : une garde qui ne
 * comprend plus sa source doit se taire bruyamment, jamais passer en silence.
 */
function readThemeTables() {
  const tables = { backoffice: new Map(), pos: new Map() };
  const unclassified = [];
  for (const file of TOKEN_SOURCES) {
    let src;
    try { src = readFileSync(join(ROOT, file), 'utf8'); } catch { return null; }
    const css = stripComments(src, 'css');
    for (const block of cssBlocks(css)) {
      const theme = themeOfSelector(block.selector);
      if (theme === null) { unclassified.push(`${file} « ${block.selector.slice(-60)} »`); continue; }
      for (const decl of css.slice(block.from, block.to).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
        for (const { hex } of colorsIn(decl[2])) {
          const list = tables[theme].get(hex) ?? [];
          if (!list.includes(decl[1])) list.push(decl[1]);
          tables[theme].set(hex, list);
        }
      }
    }
  }
  if (unclassified.length > 0) return { unclassified };
  if (tables.backoffice.size === 0 || tables.pos.size === 0) return null;
  const union = new Map(tables.pos);
  for (const [hex, toks] of tables.backoffice) {
    union.set(hex, [...new Set([...(union.get(hex) ?? []), ...toks])]);
  }
  return { ...tables, union };
}

/**
 * Remplace tout commentaire par des espaces EN PRÉSERVANT les sauts de ligne —
 * les numéros de ligne restent donc exacts. Les chaînes (`'`, `"`, `` ` ``) sont
 * traversées telles quelles : un `//` dedans n'ouvre pas un commentaire, et un
 * hex dedans reste visible. En CSS il n'existe pas de commentaire `//`, et
 * `url(//…)` en produirait un faux — on n'y reconnaît que le bloc.
 *
 * L'automate DESCEND dans les `${…}` d'un littéral gabarit : c'est du CODE, et
 * les `className={`${A} ${cond ? … : …}`}` du dépôt y logent de vrais
 * commentaires `//`. Un balayage qui traite le gabarit comme une chaîne opaque
 * les rate — vérifié sur ComboOptionRow.tsx, dont un commentaire CITE un hex du
 * thème pour l'expliquer. Un commentaire JSX `{/* … *␀/}` n'a lui besoin
 * d'aucun cas particulier : c'est un bloc, entre accolades.
 */
function stripComments(src, kind) {
  const lineComments = kind !== 'css';
  const out = Array.from(src);
  const blank = (from, to) => {
    for (let i = from; i < to && i < out.length; i++) if (out[i] !== '\n') out[i] = ' ';
  };
  // Pile de contextes : `code` (avec sa profondeur d'accolades, pour savoir
  // quel `}` referme un `${`) et `tpl` (l'intérieur littéral d'un gabarit).
  const stack = [{ type: 'code', depth: 0 }];
  let i = 0;
  while (i < src.length) {
    const frame = stack[stack.length - 1];
    const c = src[i];

    if (frame.type === 'tpl') {
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { stack.pop(); i++; continue; }
      if (c === '$' && src[i + 1] === '{') { stack.push({ type: 'code', depth: 0 }); i += 2; continue; }
      i++;
      continue;
    }

    if (c === '/' && src[i + 1] === '*') {
      const close = src.indexOf('*/', i + 2);
      const to = close === -1 ? src.length : close + 2;
      blank(i, to);
      i = to;
      continue;
    }
    if (lineComments && c === '/' && src[i + 1] === '/') {
      let to = src.indexOf('\n', i);
      if (to === -1) to = src.length;
      blank(i, to);
      i = to;
      continue;
    }
    if (c === "'" || c === '"') {
      const quote = c;
      i++;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === quote) { i++; break; }
        // Une chaîne simple ne franchit pas la ligne : sans ce garde-fou, une
        // apostrophe française dans du texte JSX avalerait la moitié du fichier.
        if (src[i] === '\n') break;
        i++;
      }
      continue;
    }
    if (c === '`') { stack.push({ type: 'tpl' }); i++; continue; }
    if (c === '{') { frame.depth++; i++; continue; }
    if (c === '}') {
      if (frame.depth > 0) frame.depth--;
      else if (stack.length > 1) stack.pop(); // referme un `${`
      i++;
      continue;
    }
    i++;
  }
  return out.join('');
}

const themeTables = readThemeTables();
if (themeTables === null || themeTables.unclassified !== undefined) {
  console.error(`::error::GARDE 4 — impossible de lire les blocs de thème de ${TOKEN_SOURCES.join(' et ')}.`);
  for (const u of themeTables?.unclassified ?? []) console.error(`  bloc non classé : ${u}`);
  console.error(`La garde tire sa vérité de ces fichiers ; si leur forme a changé, ADAPTE LE PARSEUR.`);
  console.error(`Ne désactive pas la garde : c'est elle qui tient l'invariant.`);
  process.exit(1);
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
  if (TOKEN_SOURCES.includes(file)) continue;
  if (!SCANNED.some((p) => file.startsWith(p)) || !EXT.test(file)) continue;
  let content;
  try { content = readFileSync(join(ROOT, file), 'utf8'); } catch { continue; }
  scanned++;
  const isCss = file.endsWith('.css');
  const clean = stripComments(content, isCss ? 'css' : 'ts');
  const lines = clean.split(/\r?\n/);
  const raw = content.split(/\r?\n/);

  // Quelle table juge chaque ligne. Le back-office garde son régime d'origine —
  // la table de SON thème — ce qui laisse sa baseline exactement valide. Dans
  // `packages/ui`, un CSS est jugé bloc par bloc et un composant à l'union.
  const isBackoffice = file.startsWith('apps/backoffice/src/');
  let tableOfLine;
  if (isBackoffice) {
    tableOfLine = () => themeTables.backoffice;
  } else if (isCss) {
    const perLine = new Array(lines.length).fill(null);
    for (const block of cssBlocks(clean)) {
      const theme = themeOfSelector(block.selector);
      const first = clean.slice(0, block.from).split('\n').length - 1;
      const last = clean.slice(0, block.to).split('\n').length - 1;
      for (let k = first; k <= last; k++) perLine[k] = theme;
    }
    tableOfLine = (i) => (perLine[i] === null ? themeTables.union : themeTables[perLine[i]]);
  } else {
    tableOfLine = () => themeTables.union;
  }

  for (let i = 0; i < lines.length; i++) {
    for (const { hex } of colorsIn(lines[i])) {
      const tokens = tableOfLine(i).get(hex);
      if (tokens === undefined) continue;
      const key = `${file}\t${hex}`;
      const e = counted.get(key) ?? { count: 0, hits: [] };
      e.count++;
      e.hits.push({ file, line: i + 1, hex, tokens, text: (raw[i] ?? '').trim().slice(0, 160) });
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
  console.log(`  node scripts/ci/hardcoded-theme-colors.mjs --update-baseline`);
  console.log(`Le drapeau ne fait que DESCENDRE les comptes — il ne peut pas servir à faire passer une violation.`);
}

if (process.argv.includes('--update-baseline')) {
  if (violations.length) {
    console.error(`::error::--update-baseline REFUSE : ${violations.length} occurrence(s) au-dessus du plafond.`);
    console.error(`Ce drapeau ne sait que DESCENDRE un compte. Une couleur recopiée se corrige en`);
    console.error(`prenant le token, jamais en relevant la baseline.`);
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
  console.log(`GARDE 4 — aucune couleur du thème recopiée en dur hors baseline. ${scanned} fichiers balayés, ${themeTables.backoffice.size} teintes back-office et ${themeTables.pos.size} teintes POS lues, ${tolerated} occurrence(s) héritée(s) tolérée(s).`);
  reportSlack();
  process.exit(0);
}

console.error(`::error::GARDE 4 — ${violations.length} couleur(s) du thème recopiée(s) en dur.`);
console.error('');
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  « ${v.hex} »  = ${v.tokens.join(', ')}  (plafond ${v.overBaseline})`);
  console.error(`    ${v.text}`);
}
console.error('');
console.error('QUOI FAIRE — dans cet ordre :');
console.error('');
console.error('  1. En CLASSE Tailwind : prends l\'utilitaire du preset (`text-text-muted`,');
console.error('     `border-border-subtle`). Le hex n\'a jamais rien à faire dans un className.');
console.error('');
console.error('  2. En VALEUR JS — couleur de série Recharts, style inline : écris `var(--x)`.');
console.error('     Un `var()` est valide dans un attribut de présentation SVG (`fill`, `stroke`)');
console.error('     et dans une valeur de style : c\'est ce que fait apps/backoffice/src/features/');
console.error('     reports/utils/chartColors.ts, et onze graphes livrés le prouvent. NE PASSE PAS');
console.error('     par `getComputedStyle` : il exige que la feuille de style soit chargée ET que');
console.error('     l\'élément lu porte bien `.theme-backoffice`. En test (jsdom) il rend `\'\'`, et');
console.error('     une couleur vide emporte les snapshots. Le `var()` se résout tout seul.');
console.error('');
console.error('  3. La teinte est un CHOIX DE DATA-VIZ et non un token ? Alors elle ne doit pas');
console.error('     être égale à un token : décale-la, ou consomme le token pour de bon. Une');
console.error('     valeur qui vaut par hasard `--chart-2` suivra `--chart-2` dans la tête du');
console.error('     lecteur et le trahira au prochain changement de thème.');
console.error('');
console.error(`  4. N'AJOUTE PAS l'occurrence à ${BASELINE} :`);
console.error('     cette liste est un plafond gelé, elle ne peut que décroître.');
reportSlack();
process.exit(1);
