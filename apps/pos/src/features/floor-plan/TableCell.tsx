// apps/pos/src/features/floor-plan/TableCell.tsx
//
// Session 14 — Phase 2.D — FloorPlanModal building block.
//
// Visual ref: docs/Design/caissapp/40-floor-plan-no-selection.jpg + 41-…-selected.jpg
//
// A single table on the floor map. Renders as a rounded shape (circle or
// rectangle/pill depending on seat count), with the table name, a small
// people-icon + seat count, and a tiny status label (AVAILABLE / OCCUPIED /
// RESERVED). Status changes color (green outline / amber / muted).
//
// When selected the outline becomes white-glow on top of green to match
// ref 41. When occupied the surface tints amber-soft.

import { Users } from 'lucide-react';
import type { JSX } from 'react';
import { cn } from '@breakery/ui';

export type TableStatus = 'available' | 'occupied' | 'reserved';

export interface FloorPlanTable {
  id: string;
  name: string;
  seats: number;
  status: TableStatus;
  /** Visual shape — large (4+ seats) -> pill, small -> circle. */
  shape?: 'circle' | 'pill';
}

export interface TableCellProps {
  table: FloorPlanTable;
  selected: boolean;
  onTap: () => void;
}

const STATUS_COPY: Record<TableStatus, string> = {
  available: 'Available',
  occupied: 'Occupied',
  reserved: 'Reserved',
};

export function TableCell({ table, selected, onTap }: TableCellProps): JSX.Element {
  const shape = table.shape ?? (table.seats >= 4 ? 'pill' : 'circle');

  const surface =
    table.status === 'occupied'
      ? 'bg-amber-warn/15 border-amber-warn/50'
      : table.status === 'reserved'
        ? 'bg-text-muted/10 border-text-muted/40'
        : 'bg-green/15 border-green/50';

  const ring = selected
    ? 'ring-2 ring-offset-2 ring-offset-bg-base ring-white shadow-[0_0_24px_rgba(255,255,255,0.25)]'
    : 'ring-0';

  return (
    <button
      type="button"
      onClick={onTap}
      aria-label={`Table ${table.name}, ${STATUS_COPY[table.status]}, ${table.seats} seats`}
      aria-pressed={selected}
      data-testid={`floor-plan-cell-${table.name}`}
      data-status={table.status}
      data-selected={selected ? 'true' : 'false'}
      className={cn(
        'relative inline-flex flex-col items-center justify-center',
        'border-2 transition-all duration-base motion-reduce:transition-none',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold focus-visible:outline-offset-2',
        'hover:brightness-110 active:scale-[0.98]',
        surface,
        ring,
        shape === 'circle'
          ? 'h-28 w-28 rounded-full'
          : 'h-24 w-44 rounded-[3rem]',
      )}
    >
      <span className="font-bold text-2xl text-text-primary leading-none">{table.name}</span>
      <span className="mt-1 inline-flex items-center gap-1 text-text-secondary text-xs">
        <Users className="h-3 w-3" aria-hidden />
        <span>{table.seats}</span>
      </span>
      <span
        className={cn(
          'mt-0.5 text-[9px] uppercase tracking-widest font-semibold',
          table.status === 'occupied' && 'text-amber-warn',
          table.status === 'reserved' && 'text-text-muted',
          table.status === 'available' && 'text-green',
        )}
      >
        {STATUS_COPY[table.status]}
      </span>
    </button>
  );
}
