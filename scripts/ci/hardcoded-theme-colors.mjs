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
// LA VÉRITÉ VIENT DES TOKENS, jamais d'une liste écrite ici. On lit le bloc
// `.theme-backoffice` de packages/ui/src/tokens/colors.css et on s'en sert pour
// juger. Ajouter, retirer ou changer un token suffit donc à déplacer le verdict :
// rien à mettre à jour ici, et aucune liste à faire pourrir.
//
// POURQUOI LE BACKOFFICE SEUL — un hex du thème clair recopié dans apps/pos
// n'est pas la même faute (le POS a sa propre palette, la valeur y est un
// étranger, pas un doublon). Le périmètre est donc `apps/backoffice/src`.
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
const TOKENS = 'packages/ui/src/tokens/colors.css';
const BLOCK = '.theme-backoffice {';

const SCANNED = ['apps/backoffice/src/'];
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
 * Extrait le bloc `.theme-backoffice { … }` par équilibrage d'accolades et en
 * tire la table `hex normalisé → [tokens qui le portent]`. Parseur volontairement
 * étroit : il connaît la forme de CE fichier. S'il ne trouve rien, la garde
 * ÉCHOUE — une garde qui ne sait plus lire sa source doit se taire bruyamment,
 * jamais passer en silence.
 */
function readThemeHexes() {
  let src;
  try { src = readFileSync(join(ROOT, TOKENS), 'utf8'); } catch { return null; }
  const start = src.indexOf(BLOCK);
  if (start === -1) return null;
  let depth = 0, end = -1;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) return null;
  const body = stripComments(src.slice(src.indexOf('{', start) + 1, end), 'css');

  const map = new Map(); // hex -> [tokens]
  for (const decl of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    HEX_RE.lastIndex = 0;
    for (const hit of decl[2].matchAll(HEX_RE)) {
      const hex = normalizeHex(hit[0]);
      const list = map.get(hex) ?? [];
      if (!list.includes(decl[1])) list.push(decl[1]);
      map.set(hex, list);
    }
  }
  return map.size > 0 ? map : null;
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

const themeHexes = readThemeHexes();
if (themeHexes === null) {
  console.error(`::error::GARDE 4 — impossible de lire le bloc « ${BLOCK} » dans ${TOKENS}.`);
  console.error(`La garde tire sa vérité de ce fichier ; si sa forme a changé, ADAPTE LE PARSEUR.`);
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
  if (!SCANNED.some((p) => file.startsWith(p)) || !EXT.test(file)) continue;
  let content;
  try { content = readFileSync(join(ROOT, file), 'utf8'); } catch { continue; }
  scanned++;
  const lines = stripComments(content, file.endsWith('.css') ? 'css' : 'ts').split(/\r?\n/);
  const raw = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    HEX_RE.lastIndex = 0;
    let m;
    while ((m = HEX_RE.exec(lines[i])) !== null) {
      const hex = normalizeHex(m[0]);
      const tokens = themeHexes.get(hex);
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
  console.log(`GARDE 4 — aucune couleur du thème recopiée en dur hors baseline. ${scanned} fichiers balayés, ${themeHexes.size} teintes lues dans .theme-backoffice, ${tolerated} occurrence(s) héritée(s) tolérée(s).`);
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
