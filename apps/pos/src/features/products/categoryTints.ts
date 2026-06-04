// apps/pos/src/features/products/categoryTints.ts
//
// Per-category visual identity for the POS category rail (CategoryNav).
// Each entry carries:
//   - tint   : "R,G,B" triplet, fed to `--cat-tint` → translucent fill/border
//              (opacities are applied in index.css `.cat-btn`).
//   - accent : solid hex, fed to `--cat-accent` → label + active accent bar.
//   - Icon   : the closest lucide-react glyph for the category.
//
// Lookup is by a normalized key derived from the category slug OR name, with a
// few aliases (plurals / spelling variants). Unknown categories fall back to a
// warm gold-neutral tint so a new DB category still renders coherently.

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
  Icon: LucideIcon;
}

const CATEGORY_STYLES: Record<string, CategoryStyle> = {
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
  breads: 'bread',
  pastries: 'pastry',
  sandwich: 'sandwiches',
  bagels: 'bagel',
  plates: 'plate',
  savory: 'savoury',
  savouries: 'savoury',
  viennoiseries: 'viennoiserie',
  ingredients: 'ingredient',
  combo: 'combos',
  favorite: 'favorites',
  favourites: 'favorites',
};

const DEFAULT_STYLE: CategoryStyle = {
  tint: '170,140,95',
  accent: '#cbb083',
  Icon: LayoutGrid,
};

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z]/g, '');
}

/**
 * Resolve the visual style for a category given its slug and/or display name.
 * Tries slug first, then name, then aliases, then a neutral fallback.
 */
export function categoryStyle(slugOrName: string, name?: string): CategoryStyle {
  const candidates = [slugOrName, name].filter(Boolean) as string[];
  for (const raw of candidates) {
    const key = normalize(raw);
    if (CATEGORY_STYLES[key]) return CATEGORY_STYLES[key];
    const alias = ALIASES[key];
    if (alias && CATEGORY_STYLES[alias]) return CATEGORY_STYLES[alias];
  }
  return DEFAULT_STYLE;
}
