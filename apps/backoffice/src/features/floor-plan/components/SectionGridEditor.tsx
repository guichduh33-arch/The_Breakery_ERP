// apps/backoffice/src/features/floor-plan/components/SectionGridEditor.tsx
// ADR-006 déc. 9 (floor plan visuel, lot A) — éditeur drag & drop d'une
// section : grille 12×8 (FLOOR_GRID_COLS/ROWS), une table par cellule.
// DnD HTML5 natif (BO desktop, zéro dépendance) : dragstart porte l'id de la
// table, drop sur une cellule vide → onMove(id, x, y), drop sur le bac
// « Unplaced » → onMove(id, null, null). Les cellules occupées refusent le
// drop client-side (le serveur garde cell_occupied en defense-in-depth).

import { useState, type DragEvent, type JSX } from 'react';
import { cn } from '@breakery/ui';
import { FLOOR_GRID_COLS, FLOOR_GRID_ROWS } from '@breakery/domain';
import type { RestaurantTable } from '@breakery/domain';

export interface SectionGridEditorProps {
  tables: RestaurantTable[];
  canUpdate: boolean;
  /** Disables drops while a move is in flight (évite les drops en rafale). */
  pending: boolean;
  onMove: (tableId: string, gridX: number | null, gridY: number | null) => void;
}

const DND_MIME = 'text/plain';

function TableChip({ table, canUpdate }: { table: RestaurantTable; canUpdate: boolean }): JSX.Element {
  return (
    <div
      draggable={canUpdate}
      data-testid={`fp-chip-${table.name}`}
      onDragStart={(e: DragEvent<HTMLDivElement>) => {
        e.dataTransfer.setData(DND_MIME, table.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      className={cn(
        'flex h-full w-full select-none flex-col items-center justify-center rounded-md border text-center leading-tight',
        'border-gold/50 bg-bg-elevated text-text-primary',
        !table.is_active && 'opacity-40',
        canUpdate && 'cursor-grab',
      )}
      title={`${table.name} — ${table.seats} seats${table.is_active ? '' : ' (inactive)'}`}
    >
      <span className="text-xs font-semibold">{table.name}</span>
      <span className="text-[10px] text-text-secondary">{table.seats}p</span>
    </div>
  );
}

export function SectionGridEditor({ tables, canUpdate, pending, onMove }: SectionGridEditorProps): JSX.Element {
  const [dragOver, setDragOver] = useState<string | null>(null);

  const byCell = new Map<string, RestaurantTable>();
  for (const t of tables) {
    if (t.grid_x !== null && t.grid_y !== null) byCell.set(`${t.grid_x}:${t.grid_y}`, t);
  }
  const unplaced = tables.filter((t) => t.grid_x === null);

  function acceptDrop(e: DragEvent<HTMLDivElement>, cellKey: string | null) {
    if (!canUpdate || pending) return;
    // Cellule occupée → pas de cible de drop (sauf le bac, cellKey null).
    if (cellKey !== null && byCell.has(cellKey)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }

  function handleDrop(e: DragEvent<HTMLDivElement>, gridX: number | null, gridY: number | null) {
    e.preventDefault();
    setDragOver(null);
    if (!canUpdate || pending) return;
    const tableId = e.dataTransfer.getData(DND_MIME);
    if (tableId === '') return;
    const moved = tables.find((t) => t.id === tableId);
    // Drop no-op : même cellule, ou déjà non placée déposée dans le bac.
    if (moved?.grid_x === gridX && moved.grid_y === gridY) return;
    onMove(tableId, gridX, gridY);
  }

  const cells: JSX.Element[] = [];
  for (let y = 0; y < FLOOR_GRID_ROWS; y += 1) {
    for (let x = 0; x < FLOOR_GRID_COLS; x += 1) {
      const key = `${x}:${y}`;
      const occupant = byCell.get(key);
      cells.push(
        <div
          key={key}
          data-testid={`fp-cell-${x}-${y}`}
          onDragOver={(e) => { acceptDrop(e, key); }}
          onDragEnter={() => { if (!byCell.has(key)) setDragOver(key); }}
          onDragLeave={() => { setDragOver((prev) => (prev === key ? null : prev)); }}
          onDrop={(e) => { handleDrop(e, x, y); }}
          className={cn(
            'rounded border border-dashed border-border-subtle/60 p-0.5',
            dragOver === key && 'border-gold bg-gold/10',
          )}
        >
          {occupant !== undefined && <TableChip table={occupant} canUpdate={canUpdate} />}
        </div>,
      );
    }
  }

  return (
    <div className="space-y-3">
      <div
        role="grid"
        aria-label="Section floor grid"
        className="grid gap-1"
        style={{
          gridTemplateColumns: `repeat(${FLOOR_GRID_COLS}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${FLOOR_GRID_ROWS}, 3rem)`,
        }}
      >
        {cells}
      </div>

      <div
        data-testid="fp-tray"
        onDragOver={(e) => { acceptDrop(e, null); }}
        onDrop={(e) => { handleDrop(e, null, null); }}
        className="rounded-md border border-border-subtle bg-bg-input px-3 py-2"
      >
        <div className="mb-1 text-[10px] uppercase tracking-widest text-text-secondary">
          Unplaced — drag onto the grid (drop here to remove)
        </div>
        {unplaced.length === 0 ? (
          <p className="text-xs text-text-secondary">Every table is placed.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {unplaced.map((t) => (
              <div key={t.id} className="h-12 w-20">
                <TableChip table={t} canUpdate={canUpdate} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
