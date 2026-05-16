// apps/backoffice/src/features/inventory-production/components/BakerPreviewPanel.tsx
//
// Session 15 / Phase 5.B — Read-only preview of absolute ingredient qtys
// computed from the active baker-mode recipe rows against a target flour
// mass (calls convert_baker_recipe_to_absolute_v1 via useConvertBakerToAbsolute).
//
// This is the small panel rendered below the recipe row table inside the
// RecipeEditor when baker mode is ON. Keeps RecipeEditor.tsx under the 500
// line cap.

import type { JSX } from 'react';
import type { BakerConvertResult } from '../hooks/useBakerRecipeMode.js';

export interface BakerPreviewPanelProps {
  data:             BakerConvertResult | undefined;
  /** The (debounced) target flour mass the absolute qtys were computed for. */
  targetFlourQty:   number;
  isLoading?:       boolean;
}

export function BakerPreviewPanel({
  data,
  targetFlourQty,
  isLoading = false,
}: BakerPreviewPanelProps): JSX.Element | null {
  if (isLoading) {
    return (
      <div
        className="rounded-md border border-border-subtle bg-bg-elevated px-3 py-2 text-xs text-text-secondary"
        data-testid="baker-preview-panel-loading"
      >
        Computing absolute qtys…
      </div>
    );
  }
  if (data === undefined || data.rows.length === 0) return null;

  return (
    <div
      className="rounded-md border border-border-subtle bg-bg-elevated px-3 py-2"
      data-testid="baker-preview-panel"
    >
      <div className="text-xs uppercase tracking-widest text-text-secondary mb-1">
        Absolute qtys for {targetFlourQty} g flour
      </div>
      <table className="w-full text-xs">
        <thead className="text-text-secondary">
          <tr>
            <th className="text-left py-1">Material</th>
            <th className="text-right py-1">%</th>
            <th className="text-right py-1">Absolute</th>
            <th className="text-left py-1 pl-2">Unit</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.recipe_id} data-testid="baker-preview-row">
              <td className="py-1">{r.material_name}</td>
              <td className="text-right py-1">{Number(r.baker_percentage).toFixed(2)}%</td>
              <td className="text-right py-1 font-mono">{Number(r.absolute_qty).toFixed(2)}</td>
              <td className="pl-2 py-1">{r.unit}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default BakerPreviewPanel;
