// packages/ui/src/components/AllergenBadge.tsx
//
// Session 15 / Phase 5.C — Allergen pill badge shared by POS + BO.
//
// Renders a small pill with a 2-letter abbreviation. Hover surfaces the full
// allergen name via a native title tooltip. Color mapping is consistent across
// POS grid, BO product fiche + table, and (future) receipt template.
//
// Spec ref: docs/workplan/specs/2026-05-15-session-15-spec.md §D14.
// EU regulation: 1169/2011 Annex II — 14 standard food allergens.

import type { JSX } from 'react';
import { cn } from '../lib/cn.js';

/**
 * The 14 EU standard allergens. Mirrors the `allergen_type` Postgres enum
 * (migration `20260519000160_create_allergen_type_enum.sql`). Keep this
 * union in lock-step with the DB enum.
 */
export type AllergenType =
  | 'gluten'
  | 'crustaceans'
  | 'eggs'
  | 'fish'
  | 'peanuts'
  | 'soy'
  | 'milk'
  | 'nuts'
  | 'celery'
  | 'mustard'
  | 'sesame'
  | 'sulphites'
  | 'lupin'
  | 'molluscs';

export const ALLERGEN_TYPES: readonly AllergenType[] = [
  'gluten', 'crustaceans', 'eggs', 'fish', 'peanuts', 'soy', 'milk',
  'nuts', 'celery', 'mustard', 'sesame', 'sulphites', 'lupin', 'molluscs',
] as const;

// 2-letter abbreviation per allergen, used as the visible pill text.
const ABBREV: Record<AllergenType, string> = {
  gluten:      'GL',
  crustaceans: 'CR',
  eggs:        'EG',
  fish:        'FI',
  peanuts:     'PN',
  soy:         'SO',
  milk:        'MK',
  nuts:        'NU',
  celery:      'CE',
  mustard:     'MU',
  sesame:      'SE',
  sulphites:   'SU',
  lupin:       'LU',
  molluscs:    'MO',
};

const LABEL: Record<AllergenType, string> = {
  gluten:      'Gluten',
  crustaceans: 'Crustaceans',
  eggs:        'Eggs',
  fish:        'Fish',
  peanuts:     'Peanuts',
  soy:         'Soy',
  milk:        'Milk',
  nuts:        'Nuts',
  celery:      'Celery',
  mustard:     'Mustard',
  sesame:      'Sesame',
  sulphites:   'Sulphites',
  lupin:       'Lupin',
  molluscs:    'Molluscs',
};

// Colour palette — Tailwind utility classes only, no hex.
//   gluten            -> amber
//   crustaceans/fish/molluscs -> blue (water-borne)
//   eggs/milk         -> yellow (dairy + eggs)
//   peanuts/nuts/sesame -> orange (nut/seed family)
//   soy/lupin         -> green  (legume family)
//   celery/mustard    -> lime   (vegetable/condiment)
//   sulphites         -> red    (chemical / preservative)
// Design audit 2026-07-07 (DS I-2) — migrated from raw Tailwind shades to the
// theme-aware categorical ramp (`cat-*` tokens): same hue families, but the
// text shade flips light/dark with the theme instead of being dark-locked.
const COLOR_CLASSES: Record<AllergenType, string> = {
  gluten:      'bg-cat-amber/15  text-cat-amber  border-cat-amber/30',
  crustaceans: 'bg-cat-blue/15   text-cat-blue   border-cat-blue/30',
  eggs:        'bg-cat-yellow/15 text-cat-yellow border-cat-yellow/30',
  fish:        'bg-cat-blue/15   text-cat-blue   border-cat-blue/30',
  peanuts:     'bg-cat-orange/15 text-cat-orange border-cat-orange/30',
  soy:         'bg-cat-green/15  text-cat-green  border-cat-green/30',
  milk:        'bg-cat-yellow/15 text-cat-yellow border-cat-yellow/30',
  nuts:        'bg-cat-orange/15 text-cat-orange border-cat-orange/30',
  celery:      'bg-cat-lime/15   text-cat-lime   border-cat-lime/30',
  mustard:     'bg-cat-lime/15   text-cat-lime   border-cat-lime/30',
  sesame:      'bg-cat-orange/15 text-cat-orange border-cat-orange/30',
  sulphites:   'bg-cat-red/15    text-cat-red    border-cat-red/30',
  lupin:       'bg-cat-green/15  text-cat-green  border-cat-green/30',
  molluscs:    'bg-cat-blue/15   text-cat-blue   border-cat-blue/30',
};

export type AllergenBadgeSize = 'sm' | 'md';

export interface AllergenBadgeProps {
  allergen: AllergenType;
  /** Visual scale. `sm` is used inline on cards/rows ; `md` on the editor. */
  size?: AllergenBadgeSize;
  /** Render as a filled pill (selected state in `AllergensSelector`). */
  filled?: boolean;
  className?: string;
}

export function AllergenBadge({
  allergen,
  size = 'md',
  filled = true,
  className,
}: AllergenBadgeProps): JSX.Element {
  const dim = size === 'sm'
    ? 'h-4 min-w-[1rem] px-1   text-[9px]  rounded'
    : 'h-5 min-w-[1.25rem] px-1.5 text-[10px] rounded-md';
  const tone = filled
    ? COLOR_CLASSES[allergen]
    : 'bg-transparent text-text-muted border-border-subtle';
  return (
    <span
      data-allergen={allergen}
      data-testid={`allergen-badge-${allergen}`}
      title={LABEL[allergen]}
      aria-label={LABEL[allergen]}
      className={cn(
        'inline-flex items-center justify-center border font-mono font-semibold tracking-wider uppercase select-none whitespace-nowrap',
        dim,
        tone,
        className,
      )}
    >
      {ABBREV[allergen]}
    </span>
  );
}

/** Re-exported label table for consumers that want the full word (e.g. tooltips). */
export const ALLERGEN_LABELS = LABEL;
