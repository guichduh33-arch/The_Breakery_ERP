// scripts/ci/_guard-lib.mjs
//
// Socle commun des gardes 5 à 8 — celles qui font respecter les RÈGLES NOMMÉES
// de apps/backoffice/DESIGN.md.
//
// POURQUOI UN SOCLE. Les gardes 1 à 4 sont nées une à une et portent chacune
// leur machinerie. Le relevé du 2026-08-18 a montré que les seuls invariants
// tenus à zéro sur ce dépôt sont exactement les deux qui ont un script — et que
// les quatre règles nommées sans garde étaient enfreintes de 20 à 40 fois
// chacune. Les outiller demandait quatre fois la même mécanique : lister les
// fichiers trackés, masquer les commentaires, comparer à un plafond, refuser de
// le relever. Recopier cette mécanique quatre fois, c'est quatre endroits où
// elle peut diverger.
//
// CE QUE LE SOCLE NE FAIT PAS. Il ne décide de rien. Chaque garde apporte sa
// définition du défaut (`collect`), son périmètre et son mode d'emploi. Le socle
// ne porte que ce qui est identique par construction.
//
// RÉGIME, hérité des gardes 1 à 4 : PLAFOND COMPTÉ, JAMAIS PLANCHER. La baseline
// recense ce qui existait le jour où la garde est née ; elle ne peut que
// décroître. `--update-baseline` REFUSE de tourner s'il reste une violation :
// le drapeau ne sait que descendre un compte, jamais absoudre une régression.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, '..', '..');

/** Fichiers TRACKÉS seulement : un fichier non versionné n'engage personne. */
export function trackedFiles(prefixes, extRe) {
  const out = execFileSync('git', ['ls-files', '-z', ...prefixes], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  // `git ls-files` liste l'INDEX, pas le disque : un fichier supprimé sans
  // `git rm` y figure encore, et la lecture qui suit plantait toute la garde
  // en local (critique BO du 2026-09-04 — `pages/ComingSoon.tsx`). Un fichier
  // absent n'a rien à juger ; la CI part d'un checkout neuf et ne voit jamais
  // ce cas.
  return out
    .split('\0')
    .filter((p) => p !== '' && extRe.test(p) && existsSync(join(ROOT, p)));
}

/**
 * Masque les commentaires en PRÉSERVANT LA LONGUEUR : chaque caractère de
 * commentaire devient une espace, les fins de ligne sont conservées. Les index
 * et les numéros de ligne calculés sur le masque s'appliquent donc au fichier
 * réel — c'est ce qui permet de citer `fichier:ligne` sans décalage.
 *
 * Trois pièges de ce dépôt, tous rencontrés :
 *  · le working tree est en CRLF — on ne normalise PAS `\r`, il traverse comme
 *    une espace ordinaire ; un parseur qui attend un blanc « normal » après
 *    `<input` rate 85 % des balises ;
 *  · les commentaires JSX `{/* … *\/}` échappent à une garde qui ne reconnaît
 *    qu'une ligne commençant par `//` ou `*` — c'est ce qui gèle deux entrées de
 *    la baseline de la garde 3 ;
 *  · les chaînes sont PRÉSERVÉES : c'est là que vivent les classes ;
 *  · l'INTÉRIEUR d'un `${…}` de gabarit est du CODE, pas de la chaîne. Sans la
 *    pile ci-dessous, un commentaire écrit dans une interpolation traversait le
 *    masque intact et sa citation comptait comme une infraction (relevé du
 *    2026-08-21). La pile retient la profondeur d'accolades à l'ouverture de
 *    chaque `${` : on retourne au gabarit sur le `}` qui la retrouve, jamais sur
 *    une accolade d'objet ou de bloc écrite à l'intérieur.
 */
export function maskComments(src) {
  const out = src.split('');
  let i = 0;
  let mode = 'code';
  const tplStack = [];
  let brace = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (mode === 'code') {
      if (c === '/' && n === '/') { out[i] = ' '; out[i + 1] = ' '; mode = 'line'; i += 2; continue; }
      if (c === '/' && n === '*') { out[i] = ' '; out[i + 1] = ' '; mode = 'block'; i += 2; continue; }
      if (c === "'") { mode = 'sq'; i++; continue; }
      if (c === '"') { mode = 'dq'; i++; continue; }
      if (c === '`') { mode = 'tpl'; i++; continue; }
      if (c === '{') { brace++; i++; continue; }
      if (c === '}') {
        if (tplStack.length > 0 && brace === tplStack[tplStack.length - 1]) {
          tplStack.pop(); mode = 'tpl'; i++; continue;
        }
        brace--; i++; continue;
      }
      i++; continue;
    }
    if (mode === 'line') {
      if (c === '\n') { mode = 'code'; i++; continue; }
      if (c !== '\r') out[i] = ' ';
      i++; continue;
    }
    if (mode === 'block') {
      if (c === '*' && n === '/') { out[i] = ' '; out[i + 1] = ' '; mode = 'code'; i += 2; continue; }
      if (c !== '\n' && c !== '\r') out[i] = ' ';
      i++; continue;
    }
    if (c === '\\') { i += 2; continue; }
    if (mode === 'tpl' && c === '$' && n === '{') { tplStack.push(brace); mode = 'code'; i += 2; continue; }
    if ((mode === 'sq' && c === "'") || (mode === 'dq' && c === '"') || (mode === 'tpl' && c === '`')) mode = 'code';
    i++;
  }
  return out.join('');
}

/**
 * Lit le tag OUVRANT complet à partir de l'index d'un `<`, accolades, parenthèses
 * et chaînes équilibrées. `() =>` ne ferme pas une balise : c'est le piège qui
 * fait rendre un tag tronqué et manquer l'attribut qu'on cherche.
 * Rend `null` si le tag n'est pas fermé (fichier tronqué).
 */
export function readOpenTag(masked, start) {
  let i = start + 1;
  let brace = 0, paren = 0, mode = 'code';
  while (i < masked.length) {
    const c = masked[i];
    if (mode === 'code') {
      if (c === "'") { mode = 'sq'; i++; continue; }
      if (c === '"') { mode = 'dq'; i++; continue; }
      if (c === '`') { mode = 'tpl'; i++; continue; }
      if (c === '{') { brace++; i++; continue; }
      if (c === '}') { brace--; i++; continue; }
      if (c === '(') { paren++; i++; continue; }
      if (c === ')') { paren--; i++; continue; }
      if (c === '>' && brace === 0 && paren === 0) {
        if (masked[i - 1] === '=') { i++; continue; }
        return { start, end: i + 1 };
      }
      i++; continue;
    }
    if (c === '\\') { i += 2; continue; }
    if ((mode === 'sq' && c === "'") || (mode === 'dq' && c === '"') || (mode === 'tpl' && c === '`')) mode = 'code';
    i++;
  }
  return null;
}

/**
 * Constantes de chaîne locales au fichier, CONCATÉNATIONS ET TEMPLATES COMPRIS.
 *
 * PIÈGE VÉCU : capturer n'importe quel `const` puis substituer par
 * `split(nom).join(valeur)` détruit l'analyse dès qu'un fichier déclare
 * `const d = …` — chaque lettre « d » du texte examiné est réécrite. On restreint
 * donc les noms aux formes de constante de classe, et on remplace sur FRONTIÈRE
 * DE MOT.
 */
export function localClassConstants(masked) {
  const map = new Map();
  const re = /\bconst\s+([A-Z][A-Z0-9_]{2,}|[a-zA-Z_$][\w$]*(?:ClassName|Cls|Classes))\s*=\s*/g;
  let m;
  while ((m = re.exec(masked))) {
    let i = re.lastIndex;
    const from = i;
    let brace = 0, paren = 0, mode = 'code';
    while (i < masked.length) {
      const c = masked[i];
      if (mode === 'code') {
        if (c === "'") { mode = 'sq'; i++; continue; }
        if (c === '"') { mode = 'dq'; i++; continue; }
        if (c === '`') { mode = 'tpl'; i++; continue; }
        if (c === '{') { brace++; i++; continue; }
        if (c === '}') { brace--; i++; continue; }
        if (c === '(') { paren++; i++; continue; }
        if (c === ')') { paren--; i++; continue; }
        if (c === ';' && brace === 0 && paren === 0) break;
        i++; continue;
      }
      if (c === '\\') { i += 2; continue; }
      if ((mode === 'sq' && c === "'") || (mode === 'dq' && c === '"') || (mode === 'tpl' && c === '`')) mode = 'code';
      i++;
    }
    const body = masked.slice(from, i);
    const parts = [...body.matchAll(/(['"`])([\s\S]*?)\1/g)].map((x) => x[2]);
    // Une constante peut en CITER une autre : `const numCls = `${inputCls} …``.
    // Ne garder que les segments littéraux ferait perdre l'anneau que la
    // constante citée porte, et fabriquerait un faux positif sur un champ
    // parfaitement conforme (cas vécu : GeneralInfoSection).
    const refs = [...body.matchAll(/\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g)].map((x) => x[1]);
    if (parts.length > 0 || refs.length > 0) map.set(m[1], { parts, refs });
  }

  // Résolution transitive, bornée : une chaîne de citations plus profonde que
  // cela est un problème de lisibilité, pas un cas à couvrir.
  const flat = new Map();
  for (const [name] of map) flat.set(name, resolveConstant(name, map, new Set()));
  return flat;
}

function resolveConstant(name, map, seen) {
  if (seen.has(name)) return '';
  seen.add(name);
  const entry = map.get(name);
  if (entry === undefined) return '';
  const refText = entry.refs.map((r) => resolveConstant(r, map, seen)).join(' ');
  return `${entry.parts.join(' ')} ${refText}`.trim();
}

/** Développe les constantes locales dans un fragment, sur frontière de mot. */
export function expandConstants(fragment, consts) {
  let out = fragment;
  for (const [k, v] of consts) out = out.replace(new RegExp(`\\b${k}\\b`, 'g'), ` ${v} `);
  return out;
}

export function lineOf(masked, index) {
  return masked.slice(0, index).split('\n').length;
}

function loadBaseline(relPath) {
  const map = new Map();
  const abs = join(ROOT, relPath);
  if (!existsSync(abs)) return map;
  for (const line of readFileSync(abs, 'utf8').split(/\r?\n/)) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    const [count, ...rest] = line.split('\t');
    map.set(rest.join('\t'), Number(count));
  }
  return map;
}

/**
 * Pilote commun. `collect(file, masked, raw)` rend une liste de
 * `{ key, line, text }` — `key` étant ce qui est PLAFONNÉ (souvent le chemin,
 * parfois chemin + motif).
 */
/**
 * Les TESTS sont hors périmètre de toutes ces gardes. Un test cite le défaut
 * qu'il vérifie — une chaîne « renders a unit <select> … » est du texte, pas une
 * balise, et le masque de commentaires préserve les chaînes à dessein. Les
 * juger, c'est faire crier la garde sur la preuve qu'elle a raison.
 */
export const IS_TEST = /(^|\/)__tests__\/|\.(test|spec)\.[cm]?[jt]sx?$/;

export function runGuard({ number, title, baselinePath, scanned, extRe, collect, whatToDo, scannedLabel }) {
  const baseline = loadBaseline(baselinePath);
  const files = trackedFiles(scanned, extRe).filter((f) => !IS_TEST.test(f));

  const counted = new Map();
  for (const file of files) {
    const raw = readFileSync(join(ROOT, file), 'utf8');
    const masked = maskComments(raw);
    if (masked.length !== raw.length) {
      console.error(`::error file=${file}::masque de commentaires non isométrique — la garde ${number} refuse de juger ce fichier.`);
      process.exit(1);
    }
    for (const hit of collect(file, masked, raw)) {
      const e = counted.get(hit.key) ?? { count: 0, hits: [] };
      e.count++;
      e.hits.push(hit);
      counted.set(hit.key, e);
    }
  }

  const violations = [];
  for (const [key, e] of counted) {
    const allowed = baseline.get(key) ?? 0;
    if (e.count > allowed) for (const h of e.hits.slice(allowed)) violations.push({ ...h, allowed });
  }

  const slack = [...baseline]
    .map(([key, allowed]) => ({ key, allowed, real: counted.get(key)?.count ?? 0 }))
    .filter((e) => e.real < e.allowed)
    .sort((a, b) => a.key.localeCompare(b.key));

  // AVERTISSEMENT, JAMAIS ÉCHEC — bloquer une réduction légitime tant que le
  // fichier n'est pas à jour est la meilleure façon de faire désactiver la garde.
  const reportSlack = () => {
    if (slack.length === 0) return;
    console.log('');
    for (const { key, allowed, real } of slack) {
      const file = key.split('\t')[0];
      console.log(`::warning file=${file}::la baseline peut être resserrée : « ${key} » tolère ${allowed}, le réel est ${real}`);
    }
    console.log(`${slack.length} entrée(s) de baseline au-dessus du réel. Resserre le plafond :`);
    console.log(`  node ${baselinePath.replace('-baseline.txt', '.mjs')} --update-baseline`);
    console.log(`Le drapeau ne fait que DESCENDRE les comptes — il ne peut pas servir à faire passer une violation.`);
  };

  // `--init-baseline` sert UNE FOIS, à la naissance de la garde : il fige
  // l'existant pour qu'on puisse l'allumer sans réécrire le dépôt d'abord. Il
  // n'est accepté que si la baseline est encore VIDE. Une fois une seule ligne
  // écrite, seul `--update-baseline` reste, et lui ne sait que descendre. Sans
  // cette borne, le drapeau d'amorçage deviendrait la porte de sortie de
  // n'importe quelle régression future.
  const isInit = process.argv.includes('--init-baseline');
  if (isInit && baseline.size > 0) {
    console.error(`::error::--init-baseline REFUSE : ${baselinePath} porte déjà ${baseline.size} entrée(s).`);
    console.error(`Ce drapeau n'amorce qu'une baseline VIDE. Pour resserrer un plafond existant,`);
    console.error(`c'est --update-baseline ; pour le relever, il n'y a rien — on corrige le code.`);
    process.exit(1);
  }

  if (process.argv.includes('--update-baseline') || isInit) {
    if (violations.length > 0 && !isInit) {
      console.error(`::error::--update-baseline REFUSE : ${violations.length} occurrence(s) au-dessus du plafond.`);
      console.error(`Ce drapeau ne sait que DESCENDRE un compte. Une violation se corrige dans le code.`);
      process.exit(1);
    }
    const abs = join(ROOT, baselinePath);
    const header = existsSync(abs)
      ? readFileSync(abs, 'utf8').split(/\r?\n/).filter((l) => l.trim().startsWith('#'))
      : [`# Plafond compté de la garde ${number}.`];
    const rows = [...counted.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, e]) => `${e.count}\t${key}`);
    writeFileSync(abs, `${header.join('\n')}\n${rows.join('\n')}\n`, 'utf8');
    const before = [...baseline.values()].reduce((a, b) => a + b, 0);
    const after = [...counted.values()].reduce((a, e) => a + e.count, 0);
    console.log(`Baseline resserrée : ${baseline.size} → ${rows.length} entrée(s), ${before} → ${after} occurrence(s) tolérée(s).`);
    console.log(`Commite ${baselinePath}.`);
    process.exit(0);
  }

  if (violations.length === 0) {
    const tolerated = [...counted.values()].reduce((a, e) => a + e.count, 0);
    console.log(`GARDE ${number} — ${title}. ${files.length} fichiers balayés${scannedLabel ? `, ${scannedLabel}` : ''}, ${tolerated} occurrence(s) héritée(s) tolérée(s).`);
    reportSlack();
    process.exit(0);
  }

  console.error(`::error::GARDE ${number} — ${violations.length} violation(s).`);
  console.error('');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  (plafond ${v.allowed})`);
    console.error(`    ${v.text}`);
  }
  console.error('');
  for (const line of whatToDo) console.error(line);
  console.error('');
  console.error(`  N'AJOUTE PAS l'occurrence à ${baselinePath} : cette liste est un plafond gelé,`);
  console.error('  elle ne peut que décroître.');
  reportSlack();
  process.exit(1);
}
