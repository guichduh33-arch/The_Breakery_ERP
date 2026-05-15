// packages/ui/src/components/BrandMark.tsx
//
// BrandMark — the round gold "B" Luxe Bakery logo.
//
// Session 14 D7 — appears in POS top-left (40x40), BO sidebar header (32x32),
// Customer Display empty state (centered, lg-xl), Tablet top-left, login
// pages (centered above title).
//
// Implementation is pure SVG so it stays crisp at any size. The "B" glyph is
// rendered as a styled <text> inside the SVG with the Playfair Display
// italic 400 stack via --font-display. If Playfair hasn't loaded yet, the
// browser falls back to Times New Roman (still serif italic — visually close
// enough on first paint).
//
// Position-agnostic: caller wraps in flex/grid. The component renders ONLY
// the circular badge.

import type { JSX } from 'react';
import { cn } from '../lib/cn.js';

export type BrandMarkSize = 'sm' | 'md' | 'lg' | 'xl';

export interface BrandMarkProps {
  /**
   * Size token:
   *  - sm = 32px (sidebar header, login secondary)
   *  - md = 40px (POS / Tablet top-left)
   *  - lg = 64px (Customer Display empty state)
   *  - xl = 96px (login page hero)
   */
  size?: BrandMarkSize;
  /** Tailwind class merge. */
  className?: string;
  /** Override the glyph (e.g. "TB" for The Breakery). Default 'B'. */
  glyph?: string;
  /** Accessible label. Default 'The Breakery'. */
  label?: string;
}

const SIZE_PX: Record<BrandMarkSize, number> = {
  sm: 32,
  md: 40,
  lg: 64,
  xl: 96,
};

export function BrandMark({
  size = 'md',
  className,
  glyph = 'B',
  label = 'The Breakery',
}: BrandMarkProps): JSX.Element {
  const px = SIZE_PX[size];
  // Glyph sized 60% of the circle — visually balanced for serif italic.
  const fontSize = Math.round(px * 0.6);
  return (
    <span
      role="img"
      aria-label={label}
      className={cn('inline-flex items-center justify-center', className)}
      style={{ width: px, height: px }}
    >
      <svg
        viewBox="0 0 100 100"
        width={px}
        height={px}
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        focusable="false"
      >
        <circle cx="50" cy="50" r="48" fill="var(--gold-base)" />
        <circle
          cx="50"
          cy="50"
          r="46"
          fill="none"
          stroke="var(--gold-strong)"
          strokeWidth="1"
          opacity="0.4"
        />
        <text
          x="50"
          y="50"
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="var(--font-display)"
          fontStyle="italic"
          fontWeight="400"
          fontSize={fontSize}
          fill="var(--gold-fg)"
        >
          {glyph}
        </text>
      </svg>
    </span>
  );
}
