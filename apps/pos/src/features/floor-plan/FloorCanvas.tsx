// apps/pos/src/features/floor-plan/FloorCanvas.tsx
//
// ADR-006 déc. 9 (floor plan visuel, lot B) — rendu positionné partagé par
// le POS (FloorPlanModal) et la tablette (FloorPlanView).
//
// En mode caisse, une section dont au moins une table porte des coordonnées (grid_x/grid_y,
// posées dans l'éditeur BO du lot A) est rendue sur la grille 12×8
// (FLOOR_GRID_COLS/ROWS) ; ses tables non placées restent en flux sous le
// canvas. Une section sans aucune position garde le flex-wrap historique à
// l'identique. Le mode tablette recadre les marges vides et adapte les cases
// à la hauteur disponible, tout en conservant les positions relatives.

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
  /** Tablette : utiliser tout l'espace disponible, sans les marges vides du plan. */
  fitToViewport?: boolean;
}

export function FloorCanvas({ tables, renderTable, gapClass, fitToViewport = false }: FloorCanvasProps): JSX.Element {
  const placed = tables.filter((t) => t.grid_x !== null && t.grid_y !== null);

  if (fitToViewport) {
    const unplaced = tables.filter((t) => t.grid_x === null || t.grid_y === null);
    // Recadrer les cases vides préserve la disposition relative des tables.
    const left = Math.min(...placed.map((t) => t.grid_x ?? 0));
    const top = Math.min(...placed.map((t) => t.grid_y ?? 0));
    const columns = Math.max(...placed.map((t) => t.grid_x ?? 0)) - left + 1;
    const rows = Math.max(...placed.map((t) => t.grid_y ?? 0)) - top + 1;
    const flowColumns = Math.max(1, Math.ceil(Math.sqrt(unplaced.length)));
    return (
      <div className="h-full min-h-0 flex flex-col gap-3">
        {placed.length > 0 && (
          <div data-testid="floor-grid" className="flex-1 min-h-0 grid gap-2" style={{
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
          }}>
            {placed.map((t) => (
              <div key={t.id} className="min-h-0 min-w-0" data-testid={`floor-pos-${t.grid_x}-${t.grid_y}`}
                style={{ gridColumnStart: (t.grid_x ?? 0) - left + 1, gridRowStart: (t.grid_y ?? 0) - top + 1 }}>
                {renderTable(t, true)}
              </div>
            ))}
          </div>
        )}
        {unplaced.length > 0 && (
          <div data-testid="floor-unplaced" className="min-h-0 grid gap-2"
            style={{ flex: placed.length ? Math.max(1, Math.ceil(unplaced.length / flowColumns)) / Math.max(1, rows) : 1,
              gridTemplateColumns: `repeat(${flowColumns}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${Math.ceil(unplaced.length / flowColumns)}, minmax(0, 1fr))` }}>
            {unplaced.map((t) => <div key={t.id} className="min-h-0 min-w-0">{renderTable(t, true)}</div>)}
          </div>
        )}
      </div>
    );
  }

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
      {/* Audit 2026-08-24 (responsive P0) — minmax(0,1fr) laissait les 12
          colonnes rétrécir sous la cible tactile (23 px par table à 390 px de
          large). Plancher à 3.5rem : en dessous, la grille garde sa taille et
          défile dans le conteneur overflow-auto du parent au lieu d'écraser
          les tables. */}
      <div
        data-testid="floor-grid"
        className="grid gap-1.5"
        style={{
          gridTemplateColumns: `repeat(${FLOOR_GRID_COLS}, minmax(3.5rem, 1fr))`,
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
          <p className="mb-3 text-xs uppercase tracking-widest text-text-muted">
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
