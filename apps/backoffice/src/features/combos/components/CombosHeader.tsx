// apps/backoffice/src/features/combos/components/CombosHeader.tsx
//
// Session 47 — Header strip on the Combo Management page.
// "Create New Combo" gated on combos.create; navigates to /combos/new.

import { Box, Plus } from 'lucide-react';
import type { JSX } from 'react';

interface Props {
  /** Provided when the user has combos.create permission. */
  onCreate?: () => void;
}

export function CombosHeader({ onCreate }: Props): JSX.Element {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-gold-soft text-gold">
          <Box className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <h1 className="font-display text-3xl text-text-primary">Combo Management</h1>
          <p className="text-sm italic text-text-secondary">
            Create artisan bundles and curated sets at premium value
          </p>
        </div>
      </div>
      {onCreate !== undefined && (
        <button
          type="button"
          onClick={onCreate}
          className="inline-flex items-center gap-2 rounded-full bg-gold px-5 py-2.5 text-sm font-semibold uppercase tracking-wide text-bg-base hover:bg-gold-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold transition-colors"
          data-testid="create-combo-btn"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Create New Combo
        </button>
      )}
    </div>
  );
}
