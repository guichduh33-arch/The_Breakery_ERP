// apps/pos/src/features/products/categoryTints.ts
//
// Per-category visual identity for the POS category rail (CategoryNav).
// Each entry carries:
//   - tint   : "R,G,B" triplet, fed to `--cat-tint` → translucent fill/border
//              (opacities are applied in index.css `.cat-btn`).
//   - accent : solid hex, fed to `--cat-accent` → label + active accent bar.
//   - Icon   : the closest lucide-react glyph — OR undefined when no keyword
//              matches, in which case CategoryNav renders a MONOGRAM (the
//              category's initial) instead of a generic grid glyph.
//
// Lookup (design fix 2026-07-10, addresses "9 categories all show the grid
// icon"): the old exact-key map missed every COMPOUND DB name — normalize(
// "Classic Viennoiserie") = "classicviennoiserie" matched no key, so every
// such category fell back to LayoutGrid. Now we ALSO try a substring/keyword
// match (name CONTAINS "viennoiserie" → Croissant), and when nothing matches
// we return NO icon + a per-category colour derived from the name, so the rail
// renders a distinct coloured initial rather than N identical grids.

import {
  Star,
  LayoutGrid,
  CupSoda,
  Wheat,
  Cookie,
  Sandwich,
  Donut,
  UtensilsCrossed,
  Drumstick,
  Croissant,
  FlaskConical,
  type LucideIcon,
} from 'lucide-react';

export interface CategoryStyle {
  /** "R,G,B" — consumed via the `--cat-tint` CSS custom property. */
  tint: string;
  /** Solid accent hex — consumed via the `--cat-accent` CSS custom property. */
  accent: string;
  /** Matched glyph, or undefined → CategoryNav renders a monogram instead. */
  Icon?: LucideIcon;
}

interface KeyedStyle extends Required<Pick<CategoryStyle, 'tint' | 'accent'>> {
  Icon: LucideIcon;
}

const CATEGORY_STYLES: Record<string, KeyedStyle> = {
  favorites: { tint: '201,162,75', accent: '#d8b35e', Icon: Star },
  combos: { tint: '176,141,87', accent: '#caa56a', Icon: LayoutGrid },
  beverage: { tint: '139,115,85', accent: '#c2a37e', Icon: CupSoda },
  bread: { tint: '170,120,70', accent: '#cf9a5e', Icon: Wheat },
  pastry: { tint: '181,138,96', accent: '#d4a878', Icon: Cookie },
  sandwiches: { tint: '150,130,90', accent: '#c4b079', Icon: Sandwich },
  bagel: { tint: '158,126,82', accent: '#cb9f6c', Icon: Donut },
  plate: { tint: '120,128,118', accent: '#a9b4a4', Icon: UtensilsCrossed },
  savoury: { tint: '158,108,86', accent: '#cf947a', Icon: Drumstick },
  viennoiserie: { tint: '186,148,92', accent: '#dab277', Icon: Croissant },
  ingredient: { tint: '128,138,128', accent: '#a6b39e', Icon: FlaskConical },
};

/** Aliases → canonical key (handles plurals / spelling variants from the DB). */
const ALIASES: Record<string, string> = {
  beverages: 'beverage',
  drinks: 'beverage',
  drink: 'beverage',
  coffee: 'beverage',
  breads: 'bread',
  pastries: 'pastry',
  cake: 'pastry',
  cakes: 'pastry',
  cookie: 'pastry',
  cookies: 'pastry',
  sandwich: 'sandwiches',
  bagels: 'bagel',
  plates: 'plate',
  mains: 'plate',
  savory: 'savoury',
  savouries: 'savoury',
  classic: 'viennoiserie',
  viennoiseries: 'viennoiserie',
  croissant: 'viennoiserie',
  croissants: 'viennoiserie',
  ingredients: 'ingredient',
  combo: 'combos',
  favorite: 'favorites',
  favourites: 'favorites',
};

// Keyword list for substring matching, longest-first so a specific keyword
// ("viennoiserie") is tried before a shorter one that could appear inside it.
const SUBSTRING_KEYS: string[] = [...Object.keys(CATEGORY_STYLES), ...Object.keys(ALIASES)]
  .sort((a, b) => b.length - a.length);

// Warm bakery palette for UNMATCHED categories — each derived deterministically
// from the name so every category gets a distinct coloured monogram.
const FALLBACK_PALETTE: { tint: string; accent: string }[] = [
  { tint: '176,108,78', accent: '#d18a63' }, // terracotta
  { tint: '150,120,72', accent: '#cbab6a' }, // honey
  { tint: '124,140,116', accent: '#a7bd9c' }, // sage
  { tint: '168,138,96', accent: '#d0ab77' }, // wheat
  { tint: '140,112,96', accent: '#bd9682' }, // cocoa
  { tint: '150,116,128', accent: '#c095a4' }, // plum
];

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z]/g, '');
}

function resolveKey(key: string): KeyedStyle | undefined {
  if (CATEGORY_STYLES[key]) return CATEGORY_STYLES[key];
  const alias = ALIASES[key];
  if (alias && CATEGORY_STYLES[alias]) return CATEGORY_STYLES[alias];
  return undefined;
}

/** Deterministic index into the fallback palette from a label. */
function hashIndex(value: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) >>> 0;
  return h % mod;
}

/**
 * Resolve the visual style for a category given its slug and/or display name.
 * Priority: exact key/alias → substring keyword → deterministic colour (no
 * icon → monogram). Never returns the same generic grid for every unmatched
 * category.
 */
export function categoryStyle(slugOrName: string, name?: string): CategoryStyle {
  const candidates = [slugOrName, name].filter(Boolean) as string[];
  const normalized = candidates.map(normalize);

  // 1. Exact key / alias match.
  for (const key of normalized) {
    const hit = resolveKey(key);
    if (hit) return hit;
  }

  // 2. Substring keyword match (compound names like "classicviennoiserie").
  for (const cand of normalized) {
    for (const kw of SUBSTRING_KEYS) {
      if (kw.length >= 4 && cand.includes(kw)) {
        const hit = resolveKey(kw);
        if (hit) return hit;
      }
    }
  }

  // 3. No match → distinct colour derived from the name, no icon (monogram).
  const seed = normalized[0] ?? 'x';
  const pal = FALLBACK_PALETTE[hashIndex(seed, FALLBACK_PALETTE.length)]!;
  return { tint: pal.tint, accent: pal.accent };
}

/** First alphanumeric character of a label, uppercased — for the monogram. */
export function categoryMonogram(label: string): string {
  const m = /[a-z0-9]/i.exec(label.trim());
  return (m?.[0] ?? '?').toUpperCase();
}
