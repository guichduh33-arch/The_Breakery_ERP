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

function scan(): { subtle: string[]; bare: string[]; controls: number } {
  const subtle: string[] = [];
  const bare: string[] = [];
  let controls = 0;
  for (const file of walk(ROOT)) {
    const src = readFileSync(file, 'utf8').replace(/\r/g, '');
    for (const { tag, line } of controlTags(src)) {
      controls += 1;
      const at = `${file.slice(ROOT.length + 1)}:${String(line)}`;
      if (/\bborder-border-subtle\b/.test(tag)) subtle.push(at);
      if (BARE_BORDER.test(tag) && !HAS_BORDER_COLOR.test(tag)) bare.push(at);
    }
  }
  return { subtle, bare, controls };
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
});
