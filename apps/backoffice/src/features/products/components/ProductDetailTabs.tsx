// apps/backoffice/src/features/products/components/ProductDetailTabs.tsx
//
// Session 14 / Phase 4.B — Horizontal tab strip used inside the product
// detail page. Visually it sits below the page header. The selected tab gets
// a 2px gold underline.

import type { JSX } from 'react';
import { cn } from '@breakery/ui';
import type { ProductDetailTab } from '../types.js';

interface Props {
  active: ProductDetailTab;
  onChange: (tab: ProductDetailTab) => void;
}

const TABS: ReadonlyArray<{ id: ProductDetailTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'general',  label: 'General'  },
  { id: 'units',    label: 'Units'    },
  { id: 'recipe',   label: 'Recipe'   },
  { id: 'variants', label: 'Variants' },
  { id: 'modifiers', label: 'Modifiers' },
  { id: 'costing',  label: 'Costing'  },
  { id: 'purchase', label: 'Purchase' },
  { id: 'stations', label: 'Stations' },
  { id: 'history',  label: 'History'  },
];

export function ProductDetailTabs({ active, onChange }: Props): JSX.Element {
  return (
    <div className="border-b border-border-subtle">
      <nav role="tablist" aria-label="Product detail sections" className="flex flex-wrap gap-x-6">
        {TABS.map((t) => {
          const selected = t.id === active;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onChange(t.id)}
              className={cn(
                'relative -mb-px py-3 text-xs font-semibold uppercase tracking-widest transition-colors duration-fast',
                selected
                  ? 'text-gold'
                  : 'text-text-muted hover:text-text-primary',
              )}
            >
              {t.label}
              {selected && (
                <span aria-hidden className="absolute inset-x-0 -bottom-px h-0.5 bg-gold" />
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
