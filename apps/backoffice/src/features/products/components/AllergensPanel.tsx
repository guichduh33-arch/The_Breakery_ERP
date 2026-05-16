// apps/backoffice/src/features/products/components/AllergensPanel.tsx
//
// Session 15 / Phase 5.C — Allergens card on the product fiche.
//
// Top half : the resolved set (own + cascade) from
//   `view_product_allergens_resolved`, rendered as small badges. Empty -> "—".
// Bottom half : the AllergensSelector for the SELF-DECLARED list ; resolved
//   badges automatically refresh after save because the mutation invalidates
//   both queries.
//
// Mounting context — embedded in the OverviewPanel (Session 14 layout).

import { useState, type JSX } from 'react';
import { Card, AllergenBadge, SectionLabel, type AllergenType } from '@breakery/ui';
import { AllergensSelector } from './AllergensSelector.js';
import {
  useProductAllergens,
  useUpdateProductAllergens,
} from '../hooks/useProductAllergens.js';

interface Props {
  productId: string;
  /** Self-declared allergens currently stored on the product row. */
  initialOwn: ReadonlyArray<AllergenType>;
  /** Hides the editor when the operator lacks `products.update`. */
  readOnly?: boolean;
}

export function AllergensPanel({
  productId,
  initialOwn,
  readOnly = false,
}: Props): JSX.Element {
  const resolved = useProductAllergens(productId);
  const update = useUpdateProductAllergens(productId);

  const [draft, setDraft] = useState<ReadonlyArray<AllergenType>>(initialOwn);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolvedList = resolved.data ?? [];

  function onSelectorChange(next: AllergenType[]): void {
    setDraft(next);
    setDirty(true);
    setError(null);
  }

  function onSave(): void {
    setError(null);
    update.mutate(draft, {
      onSuccess: () => {
        setDirty(false);
      },
      onError: (e) => {
        setError(e instanceof Error ? e.message : 'Save failed');
      },
    });
  }

  function onReset(): void {
    setDraft(initialOwn);
    setDirty(false);
    setError(null);
  }

  return (
    <Card padding="md" data-testid="allergens-panel">
      <div className="mb-3 flex items-center justify-between">
        <SectionLabel as="h2" size="sm">Allergens</SectionLabel>
        <span className="text-[11px] uppercase tracking-widest text-text-muted">EU 1169/2011</span>
      </div>

      <div className="mb-4">
        <div className="mb-2 text-[10px] uppercase tracking-widest text-text-secondary">
          Resolved (own + cascade)
        </div>
        {resolved.isLoading ? (
          <div className="text-xs text-text-muted">Loading…</div>
        ) : resolvedList.length === 0 ? (
          <div className="text-text-muted">—</div>
        ) : (
          <div className="flex flex-wrap gap-1" data-testid="allergens-panel-resolved">
            {resolvedList.map((a) => (
              <AllergenBadge key={a} allergen={a} size="sm" />
            ))}
          </div>
        )}
      </div>

      {!readOnly && (
        <div className="border-t border-border-subtle pt-4">
          <div className="mb-2 text-[10px] uppercase tracking-widest text-text-secondary">
            Self-declared (this product)
          </div>
          <AllergensSelector
            value={draft}
            onChange={onSelectorChange}
            disabled={update.isPending}
          />
          <div className="mt-4 flex items-center justify-end gap-2">
            {error !== null && (
              <span className="mr-auto text-xs text-red" role="alert">{error}</span>
            )}
            {dirty && (
              <button
                type="button"
                onClick={onReset}
                disabled={update.isPending}
                className="rounded-md border border-border-subtle px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-text-secondary hover:bg-bg-overlay disabled:opacity-50"
              >
                Reset
              </button>
            )}
            <button
              type="button"
              onClick={onSave}
              disabled={!dirty || update.isPending}
              data-testid="allergens-panel-save"
              className="rounded-md bg-gold px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-bg-base hover:bg-gold-soft hover:text-gold disabled:cursor-not-allowed disabled:opacity-50"
            >
              {update.isPending ? 'Saving…' : 'Save allergens'}
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}
