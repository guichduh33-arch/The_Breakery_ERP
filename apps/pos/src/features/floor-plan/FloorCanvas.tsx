// apps/pos/src/features/floor-plan/FloorCanvas.tsx
//
// ADR-006 déc. 9 (floor plan visuel, lot B) — rendu positionné partagé par
// le POS (FloorPlanModal) et la tablette (FloorPlanView).
//
// Une section dont AU MOINS une table porte des coordonnées (grid_x/grid_y,
// posées dans l'éditeur BO du lot A) est rendue sur la grille 12×8
// (FLOOR_GRID_COLS/ROWS) ; ses tables non placées restent en flux sous le
// canvas. Une section sans aucune position garde le flex-wrap historique à
// l'identique — zéro régression pour les boutiques qui n'ont rien placé.

import type { JSX } from 'react';
import type { RestaurantTable } from '@breakery/domain';
import { FLOOR_GRID_COLS, FLOOR_GRID_ROWS } from '@breakery/domain';
import { cn } from '@breakery/ui';

export interface FloorCanvasProps {
  tables: RestaurantTable[];
  /**
   * Renders one table. `fit` is true for a positioned table: the cell must
   * fill its grid slot (TableCell's `fit` mode) instead of its fixed shape.
   */
  renderTable: (table: RestaurantTable, fit: boolean) => JSX.Element;
  /** Gap utility for the flow layout (POS modal: gap-6, tablette: gap-8). */
  gapClass: string;
}

export function FloorCanvas({ tables, renderTable, gapClass }: FloorCanvasProps): JSX.Element {
  const placed = tables.filter((t) => t.grid_x !== null && t.grid_y !== null);

  if (placed.length === 0) {
    return (
      <div className={cn('flex flex-wrap justify-center items-center', gapClass)}>
        {tables.map((t) => renderTable(t, false))}
      </div>
    );
  }

  const unplaced = tables.filter((t) => t.grid_x === null);

  return (
    <div className="space-y-6">
      <div
        data-testid="floor-grid"
        className="grid gap-1.5"
        style={{
          gridTemplateColumns: `repeat(${FLOOR_GRID_COLS}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${FLOOR_GRID_ROWS}, minmax(3.5rem, 5.5rem))`,
        }}
      >
        {placed.map((t) => (
          <div
            key={t.id}
            data-testid={`floor-pos-${t.grid_x}-${t.grid_y}`}
            style={{
              gridColumnStart: (t.grid_x ?? 0) + 1,
              gridRowStart: (t.grid_y ?? 0) + 1,
            }}
          >
            {renderTable(t, true)}
          </div>
        ))}
      </div>

      {unplaced.length > 0 && (
        <div data-testid="floor-unplaced" className="border-t border-dashed border-border-subtle pt-4">
          <p className="mb-3 text-[10px] uppercase tracking-widest text-text-muted">
            Unplaced tables
          </p>
          <div className={cn('flex flex-wrap justify-center items-center', gapClass)}>
            {unplaced.map((t) => renderTable(t, false))}
          </div>
        </div>
      )}
    </div>
  );
}
