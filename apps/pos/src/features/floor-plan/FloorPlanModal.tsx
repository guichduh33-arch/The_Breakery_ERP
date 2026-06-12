// apps/pos/src/features/floor-plan/FloorPlanModal.tsx
//
// Session 14 — Phase 2.D — Floor plan modal.
//
// Visual refs:
//   - 40-floor-plan-no-selection.jpg
//   - 41-floor-plan-table-t12-selected.jpg
//   - plan de table.jpg (BO editor — informs the spatial scatter)
//
// Layout per ref 40-41:
//   ┌─────────────────────────────────────────────┐
//   │ [icon] FLOOR PLAN                       [X] │  ← header (Playfair display)
//   │ Select an available table to start ...      │  ← subtitle
//   ├─────────────────────────────────────────────┤
//   │ [ INTERIOR (0) ]   [ TERRACE (6) ]          │  ← section tabs (filled = active)
//   ├─────────────────────────────────────────────┤
//   │                                             │
//   │   [T15]    [T12]                            │  ← floor canvas (dotted)
//   │   [T14]    [T11]                            │
//   │   [T13]    [T10]                            │
//   │                                             │
//   ├─────────────────────────────────────────────┤
//   │ • AVAILABLE  • OCCUPIED  • RESERVED         │  ← legend
//   │                          [ SELECT TABLE  ]  │  ← gold CTA when one selected
//   └─────────────────────────────────────────────┘
//
// This component is presentational + IO-free; the host (Pos.tsx or
// TableSelectorButton wrapper) supplies the tables and occupancy and
// receives the selected table-name back via onSelect.
//
// Sections strategy (no schema change in Session 14): tables are bucketed
// into "Interior" vs "Terrace" using sort_order < 100 / >= 100. This is a
// purely visual partition until the BO floor plan editor (Phase 5+) adds a
// real section_id column. Backwards compatible — if every table is <100,
// the Interior tab holds them all and Terrace is empty.

import { useMemo, useState } from 'react';
import { X, Home, Trees, Users } from 'lucide-react';
import type { JSX } from 'react';
import type { RestaurantTable } from '@breakery/domain';
import {
  Button,
  DialogDescription,
  DialogTitle,
  FullScreenModal,
  cn,
} from '@breakery/ui';
import { TableCell, type FloorPlanTable, type TableStatus } from './TableCell';

const SR_ONLY =
  'absolute -m-px h-px w-px overflow-hidden whitespace-nowrap border-0 p-0';

export type FloorPlanSection = 'interior' | 'terrace';

export interface FloorPlanModalProps {
  open: boolean;
  onClose: () => void;
  /** Called with the chosen table name (RestaurantTable.name) or null when cleared. */
  onSelect: (tableName: string | null) => void;
  tables: RestaurantTable[];
  /** Map of tableName → occupied flag. */
  occupancy: Record<string, boolean>;
  /** Pre-selected table name (e.g. cart.tableNumber) so the modal can highlight it. */
  initialSelection?: string | null;
}

function bucketTables(tables: RestaurantTable[]): Record<FloorPlanSection, RestaurantTable[]> {
  const interior: RestaurantTable[] = [];
  const terrace: RestaurantTable[] = [];
  for (const t of tables) {
    if (t.sort_order >= 100) terrace.push(t);
    else interior.push(t);
  }
  return { interior, terrace };
}

function toFloorPlanTable(
  t: RestaurantTable,
  occupancy: Record<string, boolean>,
): FloorPlanTable {
  const status: TableStatus = occupancy[t.name] === true ? 'occupied' : 'available';
  return {
    id: t.id,
    name: t.name,
    seats: t.seats,
    status,
    shape: t.seats >= 4 ? 'pill' : 'circle',
  };
}

export function FloorPlanModal({
  open,
  onClose,
  onSelect,
  tables,
  occupancy,
  initialSelection,
}: FloorPlanModalProps): JSX.Element {
  const buckets = useMemo(() => bucketTables(tables), [tables]);
  const initialSection: FloorPlanSection =
    buckets.terrace.length > 0 && buckets.interior.length === 0 ? 'terrace' : 'interior';
  const [section, setSection] = useState<FloorPlanSection>(initialSection);
  const [selectedName, setSelectedName] = useState<string | null>(initialSelection ?? null);

  const visible = buckets[section];
  const selected = useMemo(
    () => tables.find((t) => t.name === selectedName) ?? null,
    [tables, selectedName],
  );

  function handleConfirm(): void {
    if (!selected) return;
    onSelect(selected.name);
    onClose();
  }

  function handleTap(table: RestaurantTable): void {
    setSelectedName(table.name);
  }

  return (
    <FullScreenModal open={open} onOpenChange={(o) => !o && onClose()} accessibleTitle="Floor plan">
      <DialogTitle className={cn(SR_ONLY)}>Floor plan</DialogTitle>
      <DialogDescription className={cn(SR_ONLY)}>
        Select an available table to start a new order, or tap an occupied table to restore it.
      </DialogDescription>

      {/* Header */}
      <header className="px-6 py-4 flex items-start justify-between border-b border-border-subtle bg-bg-elevated">
        <div className="flex items-start gap-3">
          <div
            aria-hidden
            className="h-10 w-10 inline-flex items-center justify-center rounded-md bg-gold-soft text-gold"
          >
            <Users className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-display text-xl tracking-wide">FLOOR PLAN</h2>
            <p className="text-text-secondary text-sm mt-0.5">
              Select an available table to start a new order or tap an occupied table to restore it.
            </p>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
          <X className="h-5 w-5" aria-hidden />
        </Button>
      </header>

      {/* Section tabs */}
      <div className="px-6 py-4 flex items-center gap-3 border-b border-border-subtle">
        <SectionTab
          icon={<Home className="h-4 w-4" aria-hidden />}
          label="Interior"
          count={buckets.interior.length}
          active={section === 'interior'}
          onClick={() => setSection('interior')}
        />
        <SectionTab
          icon={<Trees className="h-4 w-4" aria-hidden />}
          label="Terrace"
          count={buckets.terrace.length}
          active={section === 'terrace'}
          onClick={() => setSection('terrace')}
        />
      </div>

      {/* Floor canvas */}
      <main
        className="flex-1 overflow-auto p-6"
        data-testid="floor-plan-canvas"
        aria-label={`Floor plan — ${section}`}
      >
        <div
          className={cn(
            'min-h-full rounded-xl border border-border-subtle bg-bg-elevated/40 p-6',
            'bg-[radial-gradient(circle,_rgba(201,165,87,0.08)_1px,_transparent_1px)] [background-size:18px_18px]',
          )}
        >
          {visible.length === 0 ? (
            <div className="h-full min-h-[300px] grid place-items-center text-text-muted text-sm">
              No tables configured for this section.
            </div>
          ) : (
            <div className="flex flex-wrap gap-6 justify-center items-center">
              {visible.map((t) => (
                <TableCell
                  key={t.id}
                  table={toFloorPlanTable(t, occupancy)}
                  selected={selectedName === t.name}
                  onTap={() => handleTap(t)}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Footer: legend + CTA */}
      <footer className="px-6 py-4 border-t border-border-subtle bg-bg-elevated flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4 text-xs uppercase tracking-widest font-semibold">
          <Legend tone="available" label="Available" />
          <Legend tone="occupied" label="Occupied" />
          <Legend tone="reserved" label="Reserved" />
        </div>
        <div className="flex items-center gap-3">
          <p className="text-xs text-text-muted hidden md:block">
            * Click a <span className="text-gold">gold</span> table to restore or transfer, or an{' '}
            <span className="text-green">available</span> table for a new order.
          </p>
          <Button
            variant="gold"
            size="lg"
            onClick={handleConfirm}
            disabled={!selected}
            aria-label={selected ? `Open table ${selected.name}` : 'Select a table'}
            data-testid="floor-plan-confirm"
          >
            {selected ? `Open Table ${selected.name}` : 'Select a Table'}
          </Button>
        </div>
      </footer>
    </FullScreenModal>
  );
}

function SectionTab({
  icon,
  label,
  count,
  active,
  onClick,
}: {
  icon: JSX.Element;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={`floor-plan-section-${label.toLowerCase()}`}
      className={cn(
        'inline-flex items-center gap-2 px-4 h-10 rounded-full border text-sm font-semibold uppercase tracking-widest',
        'transition-colors motion-reduce:transition-none',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold focus-visible:outline-offset-2',
        active
          ? 'bg-gold-soft border-gold text-gold'
          : 'bg-bg-elevated border-border-subtle text-text-secondary hover:text-text-primary hover:border-border-strong',
      )}
    >
      {icon}
      <span>{label}</span>
      <span className="text-xs opacity-80 font-normal">({count})</span>
    </button>
  );
}

function Legend({
  tone,
  label,
}: {
  tone: TableStatus;
  label: string;
}): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className={cn(
          'h-2.5 w-2.5 rounded-full ring-2 ring-offset-1 ring-offset-bg-elevated',
          tone === 'available' && 'bg-green ring-green/40',
          tone === 'occupied' && 'bg-amber-warn ring-amber-warn/40',
          tone === 'reserved' && 'bg-text-muted ring-text-muted/40',
        )}
      />
      <span className="text-text-secondary">{label}</span>
    </span>
  );
}
