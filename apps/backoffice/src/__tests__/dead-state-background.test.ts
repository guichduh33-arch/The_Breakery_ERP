// apps/backoffice/src/__tests__/dead-state-background.test.ts
//
// FILET ANTI-RÉGRESSION du lot « un survol qui ne peint rien n'est pas un
// survol » (2026-08-21).
//
// LE DÉFAUT. Sous `.theme-backoffice`, `--bg-elevated`, `--bg-overlay` et
// `--bg-input` pointent tous, via `var()`, sur une surface BLANCHE : trois
// alias, une seule couleur. Une classe d'ÉTAT bâtie sur l'un d'eux — un
// `hover:bg-bg-overlay` sur une carte, un `focus:bg-bg-overlay` sur une entrée
// de menu — repeint donc la surface de sa propre couleur. Ratio mesuré au
// navigateur sur le nœud vivant : 1,000:1. Rien n'apparaît, et rien ne casse :
// c'est ce qui rend le défaut invisible en revue. Douze emplacements étaient
// dans ce cas. Le bon token d'état est `--surface-4` (#e9e7e2), un vrai pas
// au-dessus du blanc.
//
// POURQUOI CE TEST N'ASSERT PAS UNE CHAÎNE DE CLASSE. Le test voisin
// `loyalty-list.smoke.test.tsx` vérifie qu'une classe est PRÉSENTE sur un nœud.
// Ce motif serait resté VERT pendant toute la vie du défaut : une classe
// présente ne prouve pas une couleur produite. On refuse donc ici la CLASSE DE
// DÉFAUT, pas ses instances — un balayage de l'arborescence.
//
// ET LA LISTE DES TOKENS INTERDITS EST DÉRIVÉE DU CSS, PAS ÉCRITE À LA MAIN.
// Le premier test résout les alias du bloc `.theme-backoffice` jusqu'à leur
// littéral et n'interdit que ceux qui COLLAPSENT sur la couleur de carte. Si un
// jour `--bg-overlay` reçoit une valeur distincte, `hover:bg-bg-overlay`
// redevient légitime et ce fichier cesse de le refuser tout seul. Sans cela le
// test graverait une croyance de 2026-08-21 au lieu de mesurer la cause.
//
// CE QUI RESTE LÉGITIME, et c'est le point : un fond NU. `bg-bg-overlay` sur un
// panneau flottant est correct — la surface se détache par sa bordure et son
// ombre, pas par son fond. Seul l'emploi en ÉTAT est mort.
//
// Pas de parseur de balises ici, contrairement à `field-border-contrast.test.ts`
// : ce défaut ne vit pas dans une balise particulière mais dans n'importe quelle
// chaîne de classe — constante partagée comprise. Le balayage est donc plus
// large, et n'a pas besoin d'équilibrer d'accolades.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const COLORS_CSS = join(__dirname, '..', '..', '..', '..', 'packages', 'ui', 'src', 'tokens', 'colors.css');

/** Préfixes d'état Tailwind. `group-hover`/`data-[…]` compris : le défaut ne
 *  dépend pas de la façon dont l'état est déclenché. */
const STATE = String.raw`(?:hover|focus|focus-visible|focus-within|active|group-hover|group-focus|data-\[[a-z0-9-]+\])`;

/** Masque les commentaires en préservant les offsets — sinon les fichiers
 *  corrigés, dont le commentaire NOMME le token mort pour expliquer le
 *  remplacement, s'accuseraient eux-mêmes. */
function mask(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/^[ \t]*\/\/.*$/gm, (m) => ' '.repeat(m.length));
}

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

/** Le bloc `.theme-backoffice { … }` de colors.css, accolade de fin en colonne 0. */
function backofficeBlock(): string {
  const css = readFileSync(COLORS_CSS, 'utf8').replace(/\r/g, '');
  const start = css.indexOf('.theme-backoffice {');
  if (start < 0) throw new Error('bloc .theme-backoffice introuvable dans colors.css');
  const end = css.indexOf('\n}', start);
  if (end < 0) throw new Error('bloc .theme-backoffice non refermé');
  return css.slice(start, end);
}

/** Déclarations `--x: y;` du bloc, commentaires CSS retirés. */
function declarations(block: string): Map<string, string> {
  const out = new Map<string, string>();
  const clean = block.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) out.set(m[1]!, m[2]!.trim());
  return out;
}

/** Suit la chaîne de `var()` jusqu'au littéral. Borné : un cycle rendrait null. */
function resolve(decls: Map<string, string>, name: string): string | null {
  let cur = name;
  for (let hops = 0; hops < 10; hops += 1) {
    const value = decls.get(cur);
    if (value === undefined) return null;
    const ref = /^var\(\s*(--[a-z0-9-]+)\s*\)$/.exec(value);
    if (ref === null) return value.toLowerCase();
    cur = ref[1]!;
  }
  return null;
}

interface Scan {
  violations: string[];
  /** Population balayée : toute mention d'un des trois tokens, état ou non. */
  mentions: number;
}

function scan(deadTokens: readonly string[]): Scan {
  const violations: string[] = [];
  let mentions = 0;
  if (deadTokens.length === 0) return { violations, mentions };

  const alt = deadTokens.join('|');
  const stateRe = new RegExp(String.raw`\b${STATE}:bg-(?:${alt})\b`, 'g');
  const anyRe = new RegExp(String.raw`\bbg-(?:${alt})\b`, 'g');

  for (const file of walk(ROOT)) {
    const masked = mask(readFileSync(file, 'utf8').replace(/\r/g, ''));
    mentions += (masked.match(anyRe) ?? []).length;
    stateRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = stateRe.exec(masked)) !== null) {
      const line = masked.slice(0, m.index).split('\n').length;
      violations.push(`${file.slice(ROOT.length + 1)}:${String(line)} — ${m[0]}`);
    }
  }
  return { violations, mentions };
}

describe('aucun état ne peint une surface de sa propre couleur', () => {
  const decls = declarations(backofficeBlock());
  const card = resolve(decls, '--surface-2');

  // Les trois alias candidats. Seuls ceux qui COLLAPSENT sur la couleur de
  // carte sont morts en tant qu'état.
  const dead = (['bg-elevated', 'bg-overlay', 'bg-input'] as const).filter(
    (t) => resolve(decls, `--${t}`) === card,
  );

  const result = scan(dead);

  it('lit bien le bloc .theme-backoffice — sinon la garde ne mesure rien', () => {
    // Sans ce garde-fou, un `colors.css` déplacé ou un bloc renommé rendrait
    // « 0 token mort » donc « 0 violation », et le test passerait pour une
    // preuve en n'ayant rien lu. C'est le mode d'échec que ce dépôt a payé.
    expect(decls.size).toBeGreaterThan(50);
    expect(card).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('les trois alias de surface collapsent bien sur la couleur de carte', () => {
    // Le fait qui rend le défaut possible. S'il cesse d'être vrai, le test
    // suivant se détend tout seul — et cette ligne-ci le dira.
    expect(dead).toEqual(['bg-elevated', 'bg-overlay', 'bg-input']);
  });

  it('balaye bien une population de mentions — sinon la garde est vide', () => {
    // Le walker et le masque doivent produire du volume. Un parseur cassé
    // rendrait « 0 violation » sur un corpus vide.
    expect(result.mentions).toBeGreaterThan(150);
  });

  it('aucun hover/focus/active ne se pose sur un token mort (ratio 1,000:1)', () => {
    expect(result.violations).toEqual([]);
  });
});
