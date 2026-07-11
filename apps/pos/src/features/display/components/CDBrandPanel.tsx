// apps/pos/src/features/display/components/CDBrandPanel.tsx
//
// Split-brand redesign (owner request 2026-07-07) — permanent LEFT HALF of the
// customer display: hero BrandLogo + slogan. The right half carries the state
// content (live cart / payment confirmation / pickup queue).
//
// The slogan is org-level copy (S73 Lot 2 — business_config.display_slogan,
// POS Settings → Customer Display); blank falls back to the brand tagline.
// The BrandLogo's own SVG tagline is disabled so the configurable slogan is
// the single line under the croissant (never two competing taglines).

import type { JSX } from 'react';

import { BrandLogo } from '@breakery/ui';

import { useOrgDisplaySettings } from '@/features/settings/hooks/useOrgDisplaySettings';

/** Built-in slogan when no org-level override is configured. */
export const DEFAULT_DISPLAY_SLOGAN = 'French Bakery & Pastry';

export function CDBrandPanel(): JSX.Element {
  const { displaySlogan } = useOrgDisplaySettings();
  const slogan = displaySlogan || DEFAULT_DISPLAY_SLOGAN;

  return (
    <section
      className="h-full flex flex-col items-center justify-center gap-8 text-center px-8"
      data-testid="cd-brand-panel"
      aria-label="The Breakery"
    >
      <BrandLogo size="xl" showTagline={false} />
      <p
        className="font-display italic text-3xl text-gold max-w-md"
        data-testid="cd-brand-slogan"
      >
        {slogan}
      </p>
    </section>
  );
}
