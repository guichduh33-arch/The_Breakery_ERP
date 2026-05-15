// apps/backoffice/src/features/recipes/components/RecipeStudio.tsx
//
// Session 14 / Phase 4.B — Standalone Recipe Studio surface.
//
// A thin wrapper around RecipeBuilder that adds a finished-product picker.
// Drop-in replacement for the legacy `inventory-production/RecipeEditor`
// when wired into the standalone "Recipes" page (the Wave 4.A
// inventory-pages subagent owns that page, so this component is exposed
// here as a building block they can pick up).

import { type JSX, useState } from 'react';
import { Card, SectionLabel } from '@breakery/ui';
import { useFinishedProducts } from '@/features/inventory-production/hooks/useFinishedProducts.js';
import { RecipeBuilder } from './RecipeBuilder.js';

export interface RecipeStudioProps {
  /** Pre-selected product id; when omitted, the user picks from the list. */
  initialProductId?: string;
  readOnly?: boolean;
}

export function RecipeStudio({ initialProductId, readOnly = false }: RecipeStudioProps): JSX.Element {
  const finished = useFinishedProducts();
  const [productId, setProductId] = useState<string>(initialProductId ?? '');

  const product = (finished.data ?? []).find((p) => p.id === productId);

  return (
    <div className="space-y-6">
      <Card padding="md">
        <SectionLabel as="h2" size="sm">Finished product</SectionLabel>
        <select
          aria-label="Finished product"
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
          className="mt-3 h-touch-min w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
        >
          <option value="">Select a finished product...</option>
          {(finished.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>
          ))}
        </select>
      </Card>

      {product !== undefined && (
        <RecipeBuilder
          productId={product.id}
          productName={product.name}
          productUnit={product.unit}
          readOnly={readOnly}
        />
      )}
    </div>
  );
}
