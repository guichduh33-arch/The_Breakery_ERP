// apps/backoffice/src/features/inventory-production/components/FeasibilityBadge.tsx
//
// Light visual indicator (success / warning / error) for the live feasibility
// check on the production form.

import type { JSX } from 'react';
import type { FeasibilityResult } from '@breakery/domain';
import { formatQuantity } from '@breakery/utils';

export function FeasibilityBadge({ result }: { result: FeasibilityResult | null }): JSX.Element | null {
  if (result === null) return null;
  if (result.feasible) {
    return (
      <div role="status" className="text-xs text-success border border-success bg-success-soft rounded px-2 py-1">
        Feasible — stock covers requirements.
      </div>
    );
  }
  return (
    <div role="alert" className="text-xs text-red border border-red bg-red-soft rounded px-2 py-1 space-y-1">
      <div className="font-semibold">Insufficient stock for:</div>
      <ul className="font-mono">
        {result.missing.map((m) => (
          <li key={m.material_id}>
            {/* L'unité n'est écrite qu'une fois, sur la quantité requise : la
                phrase compare trois mesures d'un même matériau. */}
            {m.material_name}: need {formatQuantity(m.required, m.unit)}, have {formatQuantity(m.available, null)}
            {' '}(short {formatQuantity(m.shortfall, null)})
          </li>
        ))}
      </ul>
    </div>
  );
}
