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

export const ALLERGEN_TYPES: ReadonlyArray<AllergenType> = [
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
const COLOR_CLASSES: Record<AllergenType, string> = {
  gluten:      'bg-amber-500/15  text-amber-300  border-amber-500/30',
  crustaceans: 'bg-blue-500/15   text-blue-300   border-blue-500/30',
  eggs:        'bg-yellow-500/15 text-yellow-300 border-yellow-500/30',
  fish:        'bg-blue-500/15   text-blue-300   border-blue-500/30',
  peanuts:     'bg-orange-500/15 text-orange-300 border-orange-500/30',
  soy:         'bg-green-500/15  text-green-300  border-green-500/30',
  milk:        'bg-yellow-500/15 text-yellow-300 border-yellow-500/30',
  nuts:        'bg-orange-500/15 text-orange-300 border-orange-500/30',
  celery:      'bg-lime-500/15   text-lime-300   border-lime-500/30',
  mustard:     'bg-lime-500/15   text-lime-300   border-lime-500/30',
  sesame:      'bg-orange-500/15 text-orange-300 border-orange-500/30',
  sulphites:   'bg-red-500/15    text-red-300    border-red-500/30',
  lupin:       'bg-green-500/15  text-green-300  border-green-500/30',
  molluscs:    'bg-blue-500/15   text-blue-300   border-blue-500/30',
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
