// apps/backoffice/src/features/floor-plan/components/SectionGridEditor.tsx
// ADR-006 déc. 9 (floor plan visuel, lot A) — éditeur drag & drop d'une
// section : grille 12×8 (FLOOR_GRID_COLS/ROWS), une table par cellule.
// DnD HTML5 natif (BO desktop, zéro dépendance) : dragstart porte l'id de la
// table, drop sur une cellule vide → onMove(id, x, y), drop sur le bac
// « Unplaced » → onMove(id, null, null). Les cellules occupées refusent le
// drop client-side (le serveur garde cell_occupied en defense-in-depth).
//
// Le placement était SOURIS PURE : sans souris, aucune table ne pouvait être
// posée ni déplacée (WCAG 2.1.1). Chaque puce est donc un contrôle focalisable
// qui porte le MÊME geste que le drop — flèches pour changer de cellule,
// Entrée pour poser une table du bac sur la première cellule libre, Suppr pour
// la renvoyer au bac. Tous les chemins passent par `onMove`, l'unique mutation.
//
// La grille n'annonce plus `role="grid"` : ce motif exige des `role="row"` et
// des `role="gridcell"` que la structure n'a jamais eus, plus un tabindex
// tournant. Les cellules vides ne sont pas des cibles — seules les puces le
// sont. C'est donc un simple groupe nommé, et la position se dit là où elle
// compte : dans le nom accessible de la puce.

import {
  useEffect, useId, useRef, useState,
  type DragEvent, type JSX, type KeyboardEvent,
} from 'react';
import { cn } from '@breakery/ui';
import { FLOOR_GRID_COLS, FLOOR_GRID_ROWS } from '@breakery/domain';
import type { RestaurantTable } from '@breakery/domain';
import { FOCUS_RING } from '@/components/focusRing.js';

export interface SectionGridEditorProps {
  tables: RestaurantTable[];
  canUpdate: boolean;
  /** Disables drops while a move is in flight (évite les drops en rafale). */
  pending: boolean;
  onMove: (tableId: string, gridX: number | null, gridY: number | null) => void;
}

const DND_MIME = 'text/plain';

/** Déplacements d'une cellule, au clavier. */
const ARROW_DELTA: Record<string, { dx: number; dy: number }> = {
  ArrowUp:    { dx:  0, dy: -1 },
  ArrowDown:  { dx:  0, dy:  1 },
  ArrowLeft:  { dx: -1, dy:  0 },
  ArrowRight: { dx:  1, dy:  0 },
};

/**
 * Nom accessible d'une puce. La position n'est portée par AUCUN texte visible —
 * elle n'existe que dans la disposition. C'est donc ici, et nulle part ailleurs,
 * qu'elle est dite.
 */
function chipLabel(table: RestaurantTable): string {
  const where =
    table.grid_x !== null && table.grid_y !== null
      ? `row ${String(table.grid_y + 1)} column ${String(table.grid_x + 1)}`
      : 'unplaced';
  return `Table ${table.name}, ${table.seats} seats, ${where}${table.is_active ? '' : ', inactive'}`;
}

interface TableChipProps {
  table: RestaurantTable;
  canUpdate: boolean;
  describedBy: string;
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>, table: RestaurantTable) => void;
}

function TableChip({ table, canUpdate, describedBy, onKeyDown }: TableChipProps): JSX.Element {
  return (
    <div
      draggable={canUpdate}
      data-testid={`fp-chip-${table.name}`}
      data-chip-id={table.id}
      // `role="button"` + tabIndex plutôt qu'un `<button>` : l'élément porte
      // aussi `draggable`, et le couple bouton/DnD natif n'est pas fiable sur
      // tous les navigateurs. Même patron que les dropzones du dépôt.
      role="button"
      tabIndex={canUpdate ? 0 : -1}
      aria-label={chipLabel(table)}
      aria-describedby={canUpdate ? describedBy : undefined}
      onKeyDown={(e) => { onKeyDown(e, table); }}
      onDragStart={(e: DragEvent<HTMLDivElement>) => {
        e.dataTransfer.setData(DND_MIME, table.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      className={cn(
        'flex h-full w-full select-none flex-col items-center justify-center rounded-md border text-center leading-tight',
        'border-border-gold bg-bg-elevated text-text-primary',
        FOCUS_RING,
        !table.is_active && 'opacity-40',
        canUpdate && 'cursor-grab',
      )}
      title={`${table.name} — ${table.seats} seats${table.is_active ? '' : ' (inactive)'}`}
    >
      <span className="text-xs font-semibold">{table.name}</span>
      <span className="text-xs text-text-secondary">{table.seats}p</span>
    </div>
  );
}

export function SectionGridEditor({ tables, canUpdate, pending, onMove }: SectionGridEditorProps): JSX.Element {
  const [dragOver, setDragOver] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // Une puce déplacée au clavier est DÉMONTÉE de son ancienne cellule et
  // remontée dans la nouvelle : sans rappel du focus, celui-ci retombe sur
  // `<body>` et le parcours s'arrête à la première flèche.
  const focusIdRef = useRef<string | null>(null);
  const hintId = useId();

  const byCell = new Map<string, RestaurantTable>();
  for (const t of tables) {
    if (t.grid_x !== null && t.grid_y !== null) byCell.set(`${t.grid_x}:${t.grid_y}`, t);
  }
  const unplaced = tables.filter((t) => t.grid_x === null);

  useEffect(() => {
    const id = focusIdRef.current;
    if (id === null) return;
    // Garde anti-vol de focus : on ne rappelle QUE si le démontage a laissé le
    // focus sur le document. Si l'utilisateur est reparti ailleurs, on renonce.
    const active = document.activeElement;
    if (active !== null && active !== document.body) {
      focusIdRef.current = null;
      return;
    }
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-chip-id="${id}"]`);
    if (el !== null && el !== undefined) {
      el.focus();
      focusIdRef.current = null;
    }
  }, [tables]);

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

  /** Chemin clavier — MÊME mutation que le drop, garde d'occupation comprise. */
  function moveTo(table: RestaurantTable, x: number, y: number) {
    if (x < 0 || y < 0 || x >= FLOOR_GRID_COLS || y >= FLOOR_GRID_ROWS) return;
    const occupant = byCell.get(`${x}:${y}`);
    if (occupant !== undefined && occupant.id !== table.id) return;
    focusIdRef.current = table.id;
    onMove(table.id, x, y);
  }

  /** Poser une table du bac : première cellule libre, lecture haut-gauche. */
  function placeFirstFree(table: RestaurantTable) {
    for (let y = 0; y < FLOOR_GRID_ROWS; y += 1) {
      for (let x = 0; x < FLOOR_GRID_COLS; x += 1) {
        if (!byCell.has(`${x}:${y}`)) {
          moveTo(table, x, y);
          return;
        }
      }
    }
  }

  function handleChipKey(e: KeyboardEvent<HTMLDivElement>, table: RestaurantTable) {
    if (!canUpdate || pending) return;
    const { grid_x: gx, grid_y: gy } = table;
    const placed = gx !== null && gy !== null;

    const delta = ARROW_DELTA[e.key];
    if (delta !== undefined) {
      e.preventDefault();
      if (placed) moveTo(table, gx + delta.dx, gy + delta.dy);
      else placeFirstFree(table);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!placed) placeFirstFree(table);
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      if (!placed) return;
      focusIdRef.current = table.id;
      onMove(table.id, null, null);
    }
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
            'rounded border border-dashed border-border-subtle p-0.5',
            // Survol de dépôt porté par le liseré seul (The Ink-Not-Gold Rule).
            dragOver === key && 'border-gold',
          )}
        >
          {occupant !== undefined && (
            <TableChip
              table={occupant}
              canUpdate={canUpdate}
              describedBy={hintId}
              onKeyDown={handleChipKey}
            />
          )}
        </div>,
      );
    }
  }

  return (
    <div className="space-y-3" ref={rootRef}>
      {/* Le mode d'emploi du clavier n'a pas de place à l'écran — la grille se
          lit d'un coup d'œil à la souris. Il est lié aux puces par
          `aria-describedby`, donc annoncé une fois, à la prise de focus. */}
      <p id={hintId} className="sr-only">
        Use the arrow keys to move a placed table one cell at a time. Press Enter
        on an unplaced table to put it on the first free cell. Press Delete to
        send a table back to the unplaced tray.
      </p>

      <div
        role="group"
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
        <div className="font-data font-semibold mb-1 text-xs uppercase tracking-widest text-text-secondary">
          Unplaced — drag onto the grid, or press Enter on a table (drop here to remove)
        </div>
        {unplaced.length === 0 ? (
          <p className="text-xs text-text-secondary">Every table is placed.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {unplaced.map((t) => (
              <div key={t.id} className="h-12 w-20">
                <TableChip
                  table={t}
                  canUpdate={canUpdate}
                  describedBy={hintId}
                  onKeyDown={handleChipKey}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
