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
  retail:    'bg-cat-blue/15 text-cat-blue',
  general:   'bg-cat-blue/15 text-cat-blue',
  wholesale: 'bg-cat-emerald/15 text-cat-emerald',
  vip:       'bg-cat-amber/15 text-cat-amber',
  staff:     'bg-cat-violet/15 text-cat-violet',
  asap:      'bg-cat-rose/15 text-cat-rose',
  enak:      'bg-cat-indigo/15 text-cat-indigo',
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
