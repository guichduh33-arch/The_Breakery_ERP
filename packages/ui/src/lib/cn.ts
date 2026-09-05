import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// This project compiles with Tailwind **3.x**, where a bare `outline` sets
// `outline-style: solid`. tailwind-merge 3.x is built for Tailwind 4, where a
// bare `outline` is a *width* — so its default config files `outline` in the
// `outline-w` group alongside `outline-2`.
//
// The consequence was silent and repo-wide: every
// `focus-visible:outline focus-visible:outline-2 … outline-gold` in this
// package — the design system's canonical focus ring, 15 sites across 12 files
// shared by the back-office and the POS — had its `outline` dropped as a
// duplicate of `outline-2`. What reached the DOM was a ring with a width and a
// colour and no style, so the browser's own focus ring showed instead of ours.
// Found by measuring a rendered Input against a hand-written button that does
// not route through `cn` (audit 2026-08-11).
//
// Reclassifying the bare `outline` fixes every current and future site at once;
// rewriting the 15 strings would only postpone the next copy-paste.
const twMerge = extendTailwindMerge((config) => {
  const widthEntry = config.classGroups['outline-w']?.[0] as
    | { outline?: unknown[] }
    | undefined;
  const styleEntry = config.classGroups['outline-style']?.[0] as
    | { outline?: unknown[] }
    | undefined;

  if (Array.isArray(widthEntry?.outline) && Array.isArray(styleEntry?.outline)) {
    widthEntry.outline = widthEntry.outline.filter((value) => value !== '');
    if (!styleEntry.outline.includes('')) styleEntry.outline.unshift('');
  }

  // Même classe de panne, deuxième instance : les crans TACTILES du preset
  // (`--touch-min` 44 px, `--touch-comfy` 56 px, `--touch-large` 80 px) sont des
  // clés CUSTOM. tailwind-merge ne les reconnaît dans aucun groupe de taille, si
  // bien qu'un `h-9` passé à un `Input` ne REMPLACE pas le `h-touch-min` du
  // primitif : les deux classes partent ensemble, et l'ordre du CSS généré
  // tranche — `.h-touch-min` est émis APRÈS `.h-9`, donc il gagne toujours.
  // Une barre de filtres « corrigée » en 36 px restait à 44 px, sans erreur, ni
  // au lint ni au test. Déclarer les trois crans dans les groupes de taille rend
  // l'override possible partout, une fois pour toutes.
  //
  // Portée mesurée avant l'ajout : DEUX appels seulement passent une hauteur à
  // un primitif (`QtyEditModal`, `h-touch-comfy` sur un `Button` dont la taille
  // `md` vaut déjà `h-touch-comfy`). Aucun rendu ne change aujourd'hui.
  const TOUCH = ['touch-min', 'touch-comfy', 'touch-large'];
  for (const group of ['h', 'w', 'min-h', 'min-w', 'size'] as const) {
    // Dans tailwind-merge, la clé interne du groupe porte le nom du groupe
    // (`min-h` → `{ 'min-h': [...] }`), préfixe compris.
    const entry = config.classGroups[group]?.[0] as Record<string, unknown[]> | undefined;
    const scale = entry?.[group];
    if (Array.isArray(scale)) {
      for (const token of TOUCH) if (!scale.includes(token)) scale.push(token);
    }
  }

  return config;
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
