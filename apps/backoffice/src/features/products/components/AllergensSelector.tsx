// apps/backoffice/src/features/products/components/AllergensSelector.tsx
//
// Session 15 / Phase 5.C — Multi-select widget for self-declared product
// allergens. Renders 14 toggleable pills (one per EU standard allergen).
// Selected pills are filled ; unselected are outlined.
//
// Used in the product edit fiche under the "General" tab. Reads + writes
// `products.allergens` (an `allergen_type[]` column ; migration
// `20260519000161_extend_products_allergens.sql`).

import type { JSX } from 'react';
import {
  AllergenBadge,
  ALLERGEN_TYPES,
  ALLERGEN_LABELS,
  type AllergenType,
} from '@breakery/ui';

export interface AllergensSelectorProps {
  value: ReadonlyArray<AllergenType>;
  onChange: (next: AllergenType[]) => void;
  disabled?: boolean;
  className?: string;
}

export function AllergensSelector({
  value,
  onChange,
  disabled = false,
  className,
}: AllergensSelectorProps): JSX.Element {
  const selected = new Set<AllergenType>(value);

  function toggle(a: AllergenType): void {
    if (disabled) return;
    const next = new Set(selected);
    if (next.has(a)) {
      next.delete(a);
    } else {
      next.add(a);
    }
    // Sort so the array shape is deterministic — eases comparison in tests
    // and stable RPC payloads.
    onChange(ALLERGEN_TYPES.filter((t) => next.has(t)));
  }

  return (
    <div
      data-testid="allergens-selector"
      className={`flex flex-wrap gap-1.5 ${className ?? ''}`}
      role="group"
      aria-label="Allergens"
    >
      {ALLERGEN_TYPES.map((a) => {
        const isOn = selected.has(a);
        return (
          <button
            key={a}
            type="button"
            disabled={disabled}
            onClick={() => toggle(a)}
            data-testid={`allergens-selector-toggle-${a}`}
            aria-pressed={isOn}
            aria-label={`${ALLERGEN_LABELS[a]} — ${isOn ? 'selected' : 'not selected'}`}
            className={
              disabled
                ? 'opacity-50 cursor-not-allowed'
                : 'cursor-pointer hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold rounded'
            }
          >
            <AllergenBadge allergen={a} size="md" filled={isOn} />
          </button>
        );
      })}
    </div>
  );
}
