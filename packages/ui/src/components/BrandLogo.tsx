// packages/ui/src/components/BrandLogo.tsx
//
// BrandLogo — full illustrated brand asset.
//
// Session 14 D7.2 — appears on POS Login (centered, large, above PIN
// entry), BO sidebar header (compact horizontal), Customer Display
// branded header (hero), and any "full brand statement" surface.
//
// Distinct from BrandMark — BrandMark is the round "B" badge used for
// compact, repeated chrome. BrandLogo is the illustrated croissant +
// "THE BREAKERY" wordmark + "French Bakery & Pastry" tagline composition,
// used for anchored, centered, hero placements.
//
// Implementation is inline SVG (not <img src="brand-logo.svg" />) so the
// component can :
//   - inherit theme color via CSS custom properties (--gold-base etc.)
//   - swap glyph fills based on theme prop (pos | backoffice)
//   - scale crisply at any pixel density
//   - participate in dark-mode token overrides
//
// The static file `packages/ui/src/assets/brand-logo.svg` mirrors this
// component for non-React contexts (emails, PDFs, OG images).

import type { JSX } from 'react';
import { cn } from '../lib/cn.js';

export type BrandLogoSize = 'sm' | 'md' | 'lg' | 'xl';

export interface BrandLogoProps {
  /**
   * Size token (width × height in pixels) :
   *  - sm = 120 × 60  (BO sidebar header, compact horizontal)
   *  - md = 200 × 100 (standard, e.g. modal headers)
   *  - lg = 280 × 140 (POS Login centered, default)
   *  - xl = 400 × 200 (Customer Display hero)
   */
  size?: BrandLogoSize;
  /**
   * Show the "French Bakery & Pastry" tagline. Defaults to `true` for
   * `lg` / `xl` (full brand statement) and `false` for `sm` / `md`
   * (compact horizontal placement). Pass explicitly to override.
   */
  showTagline?: boolean;
  /**
   * Optional theme override. Defaults to inheriting via CSS custom
   * properties (`--gold-base`, etc.) so the logo automatically follows
   * the host surface's theme. Pass `'pos'` / `'backoffice'` only if you
   * need to force a palette outside the normal theme cascade.
   */
  theme?: 'pos' | 'backoffice';
  /** Tailwind / className merge for the outer wrapper. */
  className?: string;
  /** Accessible label. Default 'The Breakery — French Bakery & Pastry'. */
  label?: string;
}

const SIZE_PX: Record<BrandLogoSize, { w: number; h: number }> = {
  sm: { w: 120, h: 60 },
  md: { w: 200, h: 100 },
  lg: { w: 280, h: 140 },
  xl: { w: 400, h: 200 },
};

/** Sizes where the tagline is shown by default. */
const TAGLINE_DEFAULT: Record<BrandLogoSize, boolean> = {
  sm: false,
  md: false,
  lg: true,
  xl: true,
};

/**
 * Optional theme palette overrides. When unset, the SVG inherits from
 * CSS custom properties so the host theme controls colors.
 */
const THEME_FILL: Record<
  NonNullable<BrandLogoProps['theme']>,
  { gold: string; goldSoft: string; goldHi: string; brown: string; brownDark: string }
> = {
  pos: {
    gold: '#c9a557',
    goldSoft: '#d9b56b',
    goldHi: '#f5dca8',
    brown: '#7a5230',
    brownDark: '#4d3018',
  },
  backoffice: {
    gold: '#c9a557',
    goldSoft: '#d9b56b',
    goldHi: '#f5dca8',
    brown: '#7a5230',
    brownDark: '#4d3018',
  },
};

export function BrandLogo({
  size = 'lg',
  showTagline,
  theme,
  className,
  label = 'The Breakery — French Bakery & Pastry',
}: BrandLogoProps): JSX.Element {
  const { w, h } = SIZE_PX[size];
  const withTagline = showTagline ?? TAGLINE_DEFAULT[size];

  // When a theme is forced, resolve hex palette ; otherwise use CSS vars
  // so the host page's theme cascade wins.
  const palette = theme ? THEME_FILL[theme] : null;
  const goldStroke = palette?.gold ?? 'var(--gold-base, #c9a557)';
  const goldSoft = palette?.goldSoft ?? '#d9b56b';
  const goldHi = palette?.goldHi ?? '#f5dca8';
  const brown = palette?.brown ?? '#7a5230';
  const brownDark = palette?.brownDark ?? '#4d3018';
  const accentLine = palette?.gold ?? 'var(--gold-base, #c9a557)';
  const textFill = palette?.gold ?? 'var(--gold-base, #c9a557)';

  // When tagline is hidden, we still want the artwork balanced. Use the
  // same viewBox (280×140) so coordinates stay stable, but cap the
  // rendered region with `preserveAspectRatio` by trimming the lower
  // portion via height adjustment. Cleanest approach : keep full viewBox
  // and just hide the tagline group — the outer wrapper still occupies
  // the chosen size, but the croissant + wordmark naturally center.

  return (
    <span
      role="img"
      aria-label={label}
      data-testid="brand-logo"
      data-size={size}
      data-tagline={withTagline ? 'on' : 'off'}
      className={cn('inline-flex items-center justify-center', className)}
      style={{ width: w, height: h }}
    >
      <svg
        viewBox={withTagline ? '0 0 280 140' : '0 0 280 88'}
        width={w}
        height={h}
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id="bl-croissant-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={goldSoft} />
            <stop offset="55%" stopColor="#b8854a" />
            <stop offset="100%" stopColor={brown} />
          </linearGradient>
          <linearGradient id="bl-croissant-fold" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8a5a30" />
            <stop offset="100%" stopColor={brownDark} />
          </linearGradient>
        </defs>

        {/* Wordmark — flanking accent lines + "THE BREAKERY" */}
        <line
          x1="60"
          y1="20"
          x2="92"
          y2="20"
          stroke={accentLine}
          strokeWidth="0.8"
          opacity="0.7"
        />
        <text
          x="140"
          y="24"
          textAnchor="middle"
          fontFamily="var(--font-display, 'Playfair Display', 'Times New Roman', Georgia, serif)"
          fontWeight="500"
          fontSize="14"
          letterSpacing="2.4"
          fill={textFill}
        >
          THE BREAKERY
        </text>
        <line
          x1="188"
          y1="20"
          x2="220"
          y2="20"
          stroke={accentLine}
          strokeWidth="0.8"
          opacity="0.7"
        />

        {/* Croissant illustration — centered at (140, 60) */}
        <g transform="translate(140 60)">
          {/* Main crescent body */}
          <path
            d="M -38 8
               C -38 -18, -18 -30, 0 -30
               C 18 -30, 38 -18, 38 8
               C 38 14, 35 18, 30 18
               C 28 12, 22 6, 14 6
               C 6 6, 0 12, -2 18
               C -6 14, -14 14, -18 18
               C -22 14, -30 14, -34 18
               C -36 16, -38 12, -38 8 Z"
            fill="url(#bl-croissant-fill)"
            stroke={goldStroke}
            strokeWidth="0.6"
            strokeLinejoin="round"
            opacity="1"
          />
          {/* Inner shadow band */}
          <path
            d="M -34 6
               C -28 -8, -14 -16, 0 -16
               C 14 -16, 28 -8, 34 6
               C 28 -4, 14 -10, 0 -10
               C -14 -10, -28 -4, -34 6 Z"
            fill="url(#bl-croissant-fold)"
            opacity="0.55"
          />
          {/* Highlight ridges */}
          <path
            d="M -24 -8 Q -22 0 -18 8"
            stroke="#e6c98a"
            strokeWidth="1.2"
            fill="none"
            opacity="0.7"
            strokeLinecap="round"
          />
          <path
            d="M -12 -16 Q -10 -4 -6 6"
            stroke={goldHi}
            strokeWidth="1.3"
            fill="none"
            opacity="0.75"
            strokeLinecap="round"
          />
          <path
            d="M 0 -20 Q 0 -6 0 8"
            stroke={goldHi}
            strokeWidth="1.4"
            fill="none"
            opacity="0.8"
            strokeLinecap="round"
          />
          <path
            d="M 12 -16 Q 10 -4 6 6"
            stroke={goldHi}
            strokeWidth="1.3"
            fill="none"
            opacity="0.75"
            strokeLinecap="round"
          />
          <path
            d="M 24 -8 Q 22 0 18 8"
            stroke="#e6c98a"
            strokeWidth="1.2"
            fill="none"
            opacity="0.7"
            strokeLinecap="round"
          />
          {/* Tip dots */}
          <circle cx="-36" cy="6" r="1.2" fill={brownDark} opacity="0.6" />
          <circle cx="36" cy="6" r="1.2" fill={brownDark} opacity="0.6" />
        </g>

        {/* Tagline — "French Bakery / & / Pastry" stacked */}
        {withTagline && (
          <g
            fontFamily="var(--font-display, 'Playfair Display', 'Times New Roman', Georgia, serif)"
            fontStyle="italic"
            fontWeight="400"
            fill={textFill}
            textAnchor="middle"
            data-testid="brand-logo-tagline"
          >
            <text x="140" y="100" fontSize="10">
              French Bakery
            </text>
            <text x="140" y="114" fontSize="11">
              &amp;
            </text>
            <text x="140" y="128" fontSize="10">
              Pastry
            </text>
          </g>
        )}
      </svg>
    </span>
  );
}
