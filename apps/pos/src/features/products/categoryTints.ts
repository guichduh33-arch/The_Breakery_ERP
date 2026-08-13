// apps/pos/src/features/products/categoryTints.ts
//
// Per-category visual identity for the POS category rail (CategoryNav).
//
// [P1 fix — impeccable lot 3] This used to hardcode 11+6 hex/RGB literals in
// parallel with the design system's own categorical palette. It now resolves
// each category to one of the TWELVE `cat-*` tokens declared in
// `packages/ui/tailwind-preset.ts` (DESIGN.md "La Règle des Teintes de
// Catégorie") — the only color family in the token system where alpha
// modifiers actually work (`rgb(var(--cat-x) / <alpha-value>)`; every other
// token is a bare `var()` and silently drops any `/NN` suffix). No hex, no
// raw RGB triplet, ever.
//
// `categoryStyle()` only returns the resolved TOKEN NAME (+ optional icon).
// The Tailwind CLASS STRINGS for each token live in `CAT_TOKEN_CLASSES`
// below, fully spelled out — Tailwind's content scanner needs every full
// class name to appear LITERALLY in source; building `bg-cat-${token}/10` by
// string interpolation would be silently dropped from the generated CSS.
//
// Icon: the closest lucide-react glyph — OR undefined when no keyword
// matches, in which case CategoryNav renders a MONOGRAM (the category's
// initial) instead of a generic grid glyph.
//
// Lookup (design fix 2026-07-10, addresses "9 categories all show the grid
// icon"): the old exact-key map missed every COMPOUND DB name — normalize(
// "Classic Viennoiserie") = "classicviennoiserie" matched no key, so every
// such category fell back to LayoutGrid. Now we ALSO try a substring/keyword
// match (name CONTAINS "viennoiserie" → Croissant), and when nothing matches
// we return NO icon + a per-category token derived from the name, so the
// rail renders a distinct coloured initial rather than N identical grids.

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

/** The twelve categorical identity tokens — packages/ui/tailwind-preset.ts `cat-*`. */
export type CatToken =
  | 'amber'
  | 'yellow'
  | 'orange'
  | 'lime'
  | 'green'
  | 'emerald'
  | 'cyan'
  | 'blue'
  | 'indigo'
  | 'violet'
  | 'rose'
  | 'red';

export interface CategoryStyle {
  /** cat-* design-system token — drives fill/border/text via CAT_TOKEN_CLASSES. */
  token: CatToken;
  /** Matched glyph, or undefined → CategoryNav renders a monogram instead. */
  Icon?: LucideIcon;
}

interface KeyedStyle extends Required<Pick<CategoryStyle, 'token'>> {
  Icon: LucideIcon;
}

const CATEGORY_STYLES: Record<string, KeyedStyle> = {
  favorites: { token: 'amber', Icon: Star },
  combos: { token: 'violet', Icon: LayoutGrid },
  beverage: { token: 'cyan', Icon: CupSoda },
  bread: { token: 'yellow', Icon: Wheat },
  pastry: { token: 'rose', Icon: Cookie },
  sandwiches: { token: 'lime', Icon: Sandwich },
  bagel: { token: 'orange', Icon: Donut },
  plate: { token: 'blue', Icon: UtensilsCrossed },
  savoury: { token: 'red', Icon: Drumstick },
  viennoiserie: { token: 'emerald', Icon: Croissant },
  ingredient: { token: 'indigo', Icon: FlaskConical },
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

// All twelve tokens — deterministic fallback cycle for categories beyond the
// eleven keyed above (was a 6-entry warm-only palette; every cat-* token is
// now available so overflow categories stay visually distinct too).
const FALLBACK_TOKENS: CatToken[] = [
  'amber', 'yellow', 'orange', 'lime', 'green', 'emerald',
  'cyan', 'blue', 'indigo', 'violet', 'rose', 'red',
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

/** Deterministic index into the fallback token cycle from a label. */
function hashIndex(value: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) >>> 0;
  return h % mod;
}

/**
 * Resolve the visual style for a category given its slug and/or display name.
 * Priority: exact key/alias → substring keyword → deterministic token (no
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

  // 3. No match → distinct token derived from the name, no icon (monogram).
  const seed = normalized[0] ?? 'x';
  const token = FALLBACK_TOKENS[hashIndex(seed, FALLBACK_TOKENS.length)]!;
  return { token };
}

/** First alphanumeric character of a label, uppercased — for the monogram. */
export function categoryMonogram(label: string): string {
  const m = /[a-z0-9]/i.exec(label.trim());
  return (m?.[0] ?? '?').toUpperCase();
}

interface CatTokenClasses {
  /** Fill + border at rest. */
  idle: string;
  /** Fill + border on hover (applied only while NOT the active tile). */
  hover: string;
  /** Fill + border for the active (aria-current) tile. */
  active: string;
  /** Solid text/icon color. */
  text: string;
  /** Solid fill — active-state left accent bar. */
  accentBar: string;
  /** Translucent fill behind the monogram glyph. */
  monogramBg: string;
}

// Static Tailwind class bundle per token. Written out in full (not built via
// `bg-cat-${token}/10` interpolation) so Tailwind's content scanner picks up
// every class — see file header.
export const CAT_TOKEN_CLASSES: Record<CatToken, CatTokenClasses> = {
  amber: {
    idle: 'bg-cat-amber/10 border-cat-amber/25',
    hover: 'hover:bg-cat-amber/20 hover:border-cat-amber/50',
    active: 'bg-cat-amber/25 border-cat-amber/70',
    text: 'text-cat-amber',
    accentBar: 'bg-cat-amber',
    monogramBg: 'bg-cat-amber/20',
  },
  yellow: {
    idle: 'bg-cat-yellow/10 border-cat-yellow/25',
    hover: 'hover:bg-cat-yellow/20 hover:border-cat-yellow/50',
    active: 'bg-cat-yellow/25 border-cat-yellow/70',
    text: 'text-cat-yellow',
    accentBar: 'bg-cat-yellow',
    monogramBg: 'bg-cat-yellow/20',
  },
  orange: {
    idle: 'bg-cat-orange/10 border-cat-orange/25',
    hover: 'hover:bg-cat-orange/20 hover:border-cat-orange/50',
    active: 'bg-cat-orange/25 border-cat-orange/70',
    text: 'text-cat-orange',
    accentBar: 'bg-cat-orange',
    monogramBg: 'bg-cat-orange/20',
  },
  lime: {
    idle: 'bg-cat-lime/10 border-cat-lime/25',
    hover: 'hover:bg-cat-lime/20 hover:border-cat-lime/50',
    active: 'bg-cat-lime/25 border-cat-lime/70',
    text: 'text-cat-lime',
    accentBar: 'bg-cat-lime',
    monogramBg: 'bg-cat-lime/20',
  },
  green: {
    idle: 'bg-cat-green/10 border-cat-green/25',
    hover: 'hover:bg-cat-green/20 hover:border-cat-green/50',
    active: 'bg-cat-green/25 border-cat-green/70',
    text: 'text-cat-green',
    accentBar: 'bg-cat-green',
    monogramBg: 'bg-cat-green/20',
  },
  emerald: {
    idle: 'bg-cat-emerald/10 border-cat-emerald/25',
    hover: 'hover:bg-cat-emerald/20 hover:border-cat-emerald/50',
    active: 'bg-cat-emerald/25 border-cat-emerald/70',
    text: 'text-cat-emerald',
    accentBar: 'bg-cat-emerald',
    monogramBg: 'bg-cat-emerald/20',
  },
  cyan: {
    idle: 'bg-cat-cyan/10 border-cat-cyan/25',
    hover: 'hover:bg-cat-cyan/20 hover:border-cat-cyan/50',
    active: 'bg-cat-cyan/25 border-cat-cyan/70',
    text: 'text-cat-cyan',
    accentBar: 'bg-cat-cyan',
    monogramBg: 'bg-cat-cyan/20',
  },
  blue: {
    idle: 'bg-cat-blue/10 border-cat-blue/25',
    hover: 'hover:bg-cat-blue/20 hover:border-cat-blue/50',
    active: 'bg-cat-blue/25 border-cat-blue/70',
    text: 'text-cat-blue',
    accentBar: 'bg-cat-blue',
    monogramBg: 'bg-cat-blue/20',
  },
  indigo: {
    idle: 'bg-cat-indigo/10 border-cat-indigo/25',
    hover: 'hover:bg-cat-indigo/20 hover:border-cat-indigo/50',
    active: 'bg-cat-indigo/25 border-cat-indigo/70',
    text: 'text-cat-indigo',
    accentBar: 'bg-cat-indigo',
    monogramBg: 'bg-cat-indigo/20',
  },
  violet: {
    idle: 'bg-cat-violet/10 border-cat-violet/25',
    hover: 'hover:bg-cat-violet/20 hover:border-cat-violet/50',
    active: 'bg-cat-violet/25 border-cat-violet/70',
    text: 'text-cat-violet',
    accentBar: 'bg-cat-violet',
    monogramBg: 'bg-cat-violet/20',
  },
  rose: {
    idle: 'bg-cat-rose/10 border-cat-rose/25',
    hover: 'hover:bg-cat-rose/20 hover:border-cat-rose/50',
    active: 'bg-cat-rose/25 border-cat-rose/70',
    text: 'text-cat-rose',
    accentBar: 'bg-cat-rose',
    monogramBg: 'bg-cat-rose/20',
  },
  red: {
    idle: 'bg-cat-red/10 border-cat-red/25',
    hover: 'hover:bg-cat-red/20 hover:border-cat-red/50',
    active: 'bg-cat-red/25 border-cat-red/70',
    text: 'text-cat-red',
    accentBar: 'bg-cat-red',
    monogramBg: 'bg-cat-red/20',
  },
};
