// apps/backoffice/src/features/customers/components/CustomerAvatar.tsx
//
// Session 14 / Phase 5.B — round avatar with the customer initials. Color
// derived deterministically from the name so the same customer always shows
// the same hue. Matches `customer.jpg` colored avatar bubbles.

import { useMemo, type JSX } from 'react';

const PALETTE = [
  'bg-cat-blue/80',
  'bg-cat-emerald/80',
  'bg-cat-amber/80',
  'bg-cat-rose/80',
  'bg-cat-violet/80',
  'bg-cat-cyan/80',
  'bg-cat-indigo/80',
  'bg-cat-orange/80',
];

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter((s) => s !== '');
  if (parts.length === 0) return '?';
  if (parts.length === 1) return (parts[0] ?? '').slice(0, 2).toUpperCase();
  return ((parts[0] ?? '').charAt(0) + (parts[1] ?? '').charAt(0)).toUpperCase();
}

export interface CustomerAvatarProps {
  name:      string;
  size?:     'sm' | 'md';
  className?: string;
}

export function CustomerAvatar({ name, size = 'md', className }: CustomerAvatarProps): JSX.Element {
  const tone = useMemo(() => PALETTE[hash(name) % PALETTE.length], [name]);
  const dim = size === 'sm' ? 'h-7 w-7 text-xs' : 'h-9 w-9 text-sm';
  return (
    <span
      aria-hidden
      className={[
        // `text-ink-fg`, pas `text-white` : le premier plan d'un aplat est un
        // TOKEN (DESIGN.md, dernier Don't). C'est le cran de premier plan le plus
        // clair du thème — le même que la valeur d'une tuile héro — et il suit le
        // thème, là où `text-white` est une couleur écrite en dur.
        'inline-flex items-center justify-center rounded-full font-semibold text-ink-fg',
        tone,
        dim,
        className ?? '',
      ].join(' ')}
    >
      {initialsOf(name)}
    </span>
  );
}
