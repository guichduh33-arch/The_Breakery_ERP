// packages/ui/src/components/BrandLogo.tsx
//
// BrandLogo — the official illustrated brand asset.
//
// Renders the real "The Breakery" logo : the low-poly triangulated
// croissant (mauve → gold gradient) under the "THE BREAKERY" wordmark
// (mauve "T", gold "B", thin outline letters), optionally with the
// "FAIT MAISON / FRENCH BAKERY" tagline.
//
// Two artwork variants ship as transparent PNGs so the logo drops onto
// any surface without a baked background :
//   - dark   → light (white) outline letters, for dark surfaces
//              (POS luxe-dark : Login, Customer Display, shift modals)
//   - light  → dark (black) outline letters, for light surfaces
//              (BackOffice ivory — though BO mostly uses the raw
//              /brand-logo.png in its chrome, not this component)
//
// The dark variant additionally comes with a tagline-less crop for
// compact / hero placements where a separate slogan is shown.
//
// Distinct from BrandMark — BrandMark is the round "B" badge used for
// small, repeated chrome. BrandLogo is the full brand statement.
//
// Implementation is a plain <img> (the artwork is a raster illustration,
// not a themeable vector). `packages/ui/src/assets/*.png` are the source
// files ; Vite (of the consuming app) turns the imports into URLs.

import type { JSX } from 'react';
import { cn } from '../lib/cn.js';
import logoDark from '../assets/brand-logo-dark.png';
import logoDarkPlain from '../assets/brand-logo-dark-plain.png';
import logoLight from '../assets/brand-logo-light.png';

export type BrandLogoSize = 'sm' | 'md' | 'lg' | 'xl';

export interface BrandLogoProps {
  /**
   * Size token — sets the rendered HEIGHT in pixels; width follows the
   * artwork's natural aspect ratio :
   *  - sm = 52  (compact horizontal placement)
   *  - md = 84  (standard, e.g. modal headers)
   *  - lg = 128 (POS Login centered, default)
   *  - xl = 190 (Customer Display hero)
   */
  size?: BrandLogoSize;
  /**
   * Show the "FAIT MAISON / FRENCH BAKERY" tagline. Defaults to `true`
   * for `lg` / `xl` and `false` for `sm` / `md`. Only the dark variant
   * ships a tagline crop — the light variant is always tagline-less.
   */
  showTagline?: boolean;
  /**
   * Which artwork variant to use :
   *  - `'pos'` (default) → dark-surface variant (white outline letters)
   *  - `'backoffice'`    → light-surface variant (black outline letters)
   */
  theme?: 'pos' | 'backoffice';
  /** Tailwind / className merge for the outer wrapper. */
  className?: string;
  /** Accessible label. Default 'The Breakery — French Bakery & Pastry'. */
  label?: string;
}

/** Rendered height in px per size token. Width follows aspect ratio. */
const SIZE_PX: Record<BrandLogoSize, number> = {
  sm: 52,
  md: 84,
  lg: 128,
  xl: 190,
};

/** Sizes where the tagline is shown by default. */
const TAGLINE_DEFAULT: Record<BrandLogoSize, boolean> = {
  sm: false,
  md: false,
  lg: true,
  xl: true,
};

export function BrandLogo({
  size = 'lg',
  showTagline,
  theme = 'pos',
  className,
  label = 'The Breakery — French Bakery & Pastry',
}: BrandLogoProps): JSX.Element {
  const height = SIZE_PX[size];
  const withTagline = showTagline ?? TAGLINE_DEFAULT[size];

  // The light variant has no tagline crop — it is always tagline-less.
  const taglineRendered = theme === 'pos' && withTagline;

  const src =
    theme === 'backoffice'
      ? logoLight
      : withTagline
        ? logoDark
        : logoDarkPlain;

  return (
    <span
      role="img"
      aria-label={label}
      data-testid="brand-logo"
      data-size={size}
      data-theme={theme}
      data-tagline={taglineRendered ? 'on' : 'off'}
      className={cn('inline-flex items-center justify-center', className)}
      style={{ height }}
    >
      <img
        src={src}
        alt=""
        aria-hidden="true"
        draggable={false}
        className="h-full w-auto select-none"
        style={{ height, width: 'auto' }}
      />
    </span>
  );
}
