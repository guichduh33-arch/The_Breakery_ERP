// apps/backoffice/src/features/inventory-production/components/FeasibilityBadge.tsx
//
// Light visual indicator (success / warning / error) for the live feasibility
// check on the production form.

import type { JSX } from 'react';
import type { FeasibilityResult } from '@breakery/domain';

export function FeasibilityBadge({ result }: { result: FeasibilityResult | null }): JSX.Element | null {
  if (result === null) return null;
  if (result.feasible) {
    return (
      <div role="status" className="text-xs text-success border border-success/40 bg-success-soft rounded px-2 py-1">
        Feasible — stock covers requirements.
      </div>
    );
  }
  return (
    <div role="alert" className="text-xs text-red border border-red bg-red/5 rounded px-2 py-1 space-y-1">
      <div className="font-semibold">Insufficient stock for:</div>
      <ul className="font-mono">
        {result.missing.map((m) => (
          <li key={m.material_id}>
            {m.material_name}: need {m.required.toFixed(3)} {m.unit}, have {m.available.toFixed(3)}
            {' '}(short {m.shortfall.toFixed(3)})
          </li>
        ))}
      </ul>
    </div>
  );
}
