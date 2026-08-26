// apps/backoffice/src/__tests__/field-border-contrast.test.ts
//
// FILET ANTI-RÉGRESSION du lot « la bordure d'un champ est une limite qu'on
// voit » (2026-08-20).
//
// LE DÉFAUT. `--border-subtle` (#e3e1db) vaut **1,31:1** sur la feuille blanche
// et **1,14:1** sur le papier de page. Sur un filet de carte c'est le bon token ;
// sur un CONTRÔLE c'est une limite qui n'existe pas — et la bordure est le seul
// objet qui délimite un champ, donc elle porte les **3:1 de WCAG 1.4.11**.
// `--border-strong` (#86827a) les tient : 3,83:1 feuille, 3,33:1 papier.
//
// L'arbitrage est celui du 2026-08-19, pris par le propriétaire pour les deux
// apps. Les primitifs `Input` / `Select` l'ont reçu ce jour-là ; les 164
// contrôles écrits à la main, non. DESIGN.md ne nommait qu'UN résiduel — le
// champ « Receipt file » — parce que le relevé filtrait sur une signature de
// classe. Mesure de population : **154 `border-border-subtle` + 10 `border` nus
// dans 77 fichiers, contre 1 conforme**.
//
// CE QUE LA GARDE NE COUVRE PAS, et c'est délibéré : la HAUTEUR. Ces contrôles
// sont en py-1/py-1.5/py-2 (30-36 px) là où DESIGN.md déclare 44 px. Changer une
// hauteur déplace une mise en page ; c'est un lot à part.
//
// LE TROU RÉPARÉ LE 2026-08-26. La garde ne lisait que le LITTÉRAL de la balise
// ouvrante : une classe hissée en constante — `const FIELD_CLS = '… border-
// border-subtle …'` puis `<input className={FIELD_CLS} />` — lui échappait
// entièrement. C'est exactement par là que cinq champs sont passés (dialogue de
// création de rôle, panneau d'overrides, seuils de dépense, mouvement de caisse,
// achat direct). Le parseur RÉSOUT désormais les identifiants employés dans un
// `className` contre les constantes chaîne déclarées dans le MÊME fichier,
// littéraux d'objets template compris. Le test `résout` plus bas est le
// garde-fou de ce garde-fou : un résolveur cassé rendrait « 0 violation » et le
// dépôt a déjà payé trois fois ce mode d'échec.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const TAG_RE = /<(input|select|textarea)\b/g;
/** `border` seul → Tailwind résout `borderColor.DEFAULT` = gray-200 (#e5e7eb),
 *  un gris FROID hors de l'axe ~40° du système, à 1,24:1. */
const BARE_BORDER = /(^|[\s"'`{])border(?=[\s"'`}])/;
const HAS_BORDER_COLOR =
  /\bborder-(border-[a-z]+|red|danger|gold|success|warning|info|transparent)\b/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== '__tests__') walk(p, out);
    } else if (/\.tsx?$/.test(name) && !name.includes('.test.')) {
      out.push(p);
    }
  }
  return out;
}

/** Masque les commentaires en préservant les offsets — sinon ce fichier-ci, qui
 *  cite les motifs interdits dans son en-tête, s'accuserait lui-même. */
function mask(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/^[ \t]*\/\/.*$/gm, (m) => ' '.repeat(m.length));
}

/** Contenu de chaque balise ouvrante de contrôle, accolades équilibrées :
 *  un `>` dans `() =>` ne ferme pas une balise. */
function controlTags(src: string): { tag: string; line: number }[] {
  const masked = mask(src);
  const found: { tag: string; line: number }[] = [];
  TAG_RE.lastIndex = 0;
  while (TAG_RE.exec(masked) !== null) {
    const start = TAG_RE.lastIndex;
    let i = start;
    let depth = 0;
    while (i < masked.length) {
      const c = masked[i];
      if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      else if (c === '>' && depth === 0) break;
      i += 1;
    }
    found.push({ tag: src.slice(start, i), line: src.slice(0, start).split('\n').length });
    TAG_RE.lastIndex = i;
  }
  return found;
}

/** Constantes CHAÎNE déclarées dans le fichier : `const X = '…'`, template
 *  literal, concaténation `+`, sur une ou plusieurs lignes. Une déclaration qui
 *  ne contient aucun guillemet n'est pas une chaîne et ne nous intéresse pas. */
function stringConsts(masked: string): Map<string, string> {
  const consts = new Map<string, string>();
  const DECL = /(?:^|\n)[ \t]*(?:export[ \t]+)?const[ \t]+([A-Za-z_$][\w$]*)[ \t]*(?::[^=]*)?=([^;]*);/g;
  let m: RegExpExecArray | null;
  while ((m = DECL.exec(masked)) !== null) {
    const [, name, expr] = m as unknown as [string, string, string];
    if (!/['"`]/.test(expr)) continue;
    consts.set(name, expr);
  }
  return consts;
}

/** Remplace chaque identifiant connu par « identifiant + sa valeur », en
 *  cascade : `FIELD_CLS` peut lui-même interpoler `FOCUS_RING`. La profondeur
 *  est bornée — une constante qui se cite elle-même ne doit pas boucler. */
function expand(expr: string, consts: Map<string, string>, depth = 0): string {
  if (depth > 4) return expr;
  return expr.replace(/\b[A-Za-z_$][\w$]*\b/g, (id) => {
    const value = consts.get(id);
    return value === undefined ? id : `${id} ${expand(value, consts, depth + 1)}`;
  });
}

/** Les expressions `className=…` d'une balise, accolades équilibrées. */
function classNameExprs(tag: string): string[] {
  const out: string[] = [];
  const RE = /className\s*=\s*/g;
  while (RE.exec(tag) !== null) {
    let i = RE.lastIndex;
    const open = tag[i];
    if (open === '{') {
      const start = i;
      let depth = 0;
      while (i < tag.length) {
        if (tag[i] === '{') depth += 1;
        else if (tag[i] === '}') {
          depth -= 1;
          if (depth === 0) { i += 1; break; }
        }
        i += 1;
      }
      out.push(tag.slice(start, i));
    } else if (open === '"' || open === "'") {
      // Littéral : déjà lu dans le texte de la balise, rien à résoudre.
      const end = tag.indexOf(open, i + 1);
      i = end < 0 ? tag.length : end + 1;
    }
    RE.lastIndex = i;
  }
  return out;
}

interface Scanned { subtle: string[]; bare: string[]; controls: number; resolved: number }

/** Le relevé d'UN fichier — isolé pour que le parseur soit lui-même testable. */
function scanSource(src: string, label: string): Scanned {
  const consts = stringConsts(mask(src));
  const subtle: string[] = [];
  const bare: string[] = [];
  let controls = 0;
  let resolved = 0;
  for (const { tag, line } of controlTags(src)) {
    controls += 1;
    const refs = classNameExprs(tag)
      .map((e) => expand(e, consts))
      .join(' ');
    // La classe VUE par la garde = le littéral de la balise + ce que ses
    // `className={IDENT}` désignent réellement.
    const seen = refs === '' ? tag : `${tag} ${refs}`;
    if (seen !== tag && refs.includes('border-')) resolved += 1;
    const at = `${label}:${String(line)}`;
    if (/\bborder-border-subtle\b/.test(seen)) subtle.push(at);
    if (BARE_BORDER.test(seen) && !HAS_BORDER_COLOR.test(seen)) bare.push(at);
  }
  return { subtle, bare, controls, resolved };
}

function scan(): Scanned {
  const all: Scanned = { subtle: [], bare: [], controls: 0, resolved: 0 };
  for (const file of walk(ROOT)) {
    const src = readFileSync(file, 'utf8').replace(/\r/g, '');
    const one = scanSource(src, file.slice(ROOT.length + 1));
    all.subtle.push(...one.subtle);
    all.bare.push(...one.bare);
    all.controls += one.controls;
    all.resolved += one.resolved;
  }
  return all;
}

describe('la bordure d’un contrôle tient WCAG 1.4.11', () => {
  const result = scan();

  it('balaye bien une population de contrôles — sinon la garde est vide', () => {
    // Sans ce garde-fou, un parseur cassé rendrait « 0 violation » et le test
    // resterait vert en ne mesurant rien. C’est le mode d’échec que ce dépôt a
    // déjà payé trois fois.
    expect(result.controls).toBeGreaterThan(200);
  });

  it('aucun <input|select|textarea> ne borde en border-border-subtle (1,31:1)', () => {
    expect(result.subtle).toEqual([]);
  });

  it('aucun <input|select|textarea> ne porte un « border » nu (gray-200, 1,24:1)', () => {
    expect(result.bare).toEqual([]);
  });

  it('résout bien des className={CONSTANTE} — sinon la garde est redevenue aveugle', () => {
    // Le trou du 2026-08-26 : le parseur ne lisait que le littéral de la balise.
    // Ce compte est la preuve qu'il suit encore les classes hissées.
    expect(result.resolved).toBeGreaterThan(5);
  });

  it('attrape la classe hissée en constante — le cas qui lui échappait', () => {
    const before = [
      "const FIELD = `h-9 rounded-md border border-border-subtle ${RING}`;",
      "const RING  = 'focus-visible:outline';",
      '<input className={FIELD} />',
      '<select className={`${FIELD} mt-1`} />',
      '<textarea className="border border-border-strong" />',
    ].join('\n');
    const after = before.replace('border-border-subtle', 'border-border-strong');

    expect(scanSource(before, 'fixture').subtle).toEqual(['fixture:3', 'fixture:4']);
    expect(scanSource(after, 'fixture').subtle).toEqual([]);
    expect(scanSource(after, 'fixture').bare).toEqual([]);
  });
});
