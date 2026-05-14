// apps/backoffice/src/features/customers/components/CustomerCategoryChip.tsx
//
// Session 14 / Phase 5.B — small uppercase pill for a customer's category.
// Mirrors `customer.jpg` category column (GENERAL / WHOLESALE / etc.).

import type { JSX } from 'react';

export interface CustomerCategoryChipProps {
  name: string | null;
  slug: string | null;
}

const TONES: Record<string, string> = {
  retail:    'bg-blue-500/15 text-blue-600 dark:text-blue-300',
  general:   'bg-blue-500/15 text-blue-600 dark:text-blue-300',
  wholesale: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
  vip:       'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  staff:     'bg-violet-500/15 text-violet-600 dark:text-violet-300',
  asap:      'bg-rose-500/15 text-rose-600 dark:text-rose-300',
  enak:      'bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-300',
};

const FALLBACK = 'bg-bg-overlay text-text-secondary';

export function CustomerCategoryChip({ name, slug }: CustomerCategoryChipProps): JSX.Element {
  const tone = slug !== null && TONES[slug] !== undefined ? TONES[slug] : FALLBACK;
  const label = name ?? '—';
  return (
    <span
      className={[
        'inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest',
        tone,
      ].join(' ')}
    >
      {label}
    </span>
  );
}
