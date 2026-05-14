// apps/pos/src/features/tablet/FloorPlanView.tsx
//
// Session 14 / Phase 3.C — Tablet (waiter) floor plan view.
//
// Visual refs:
//   - docs/Design/backoffice/plan de table.jpg (BO editor — informs the
//     spatial scatter for sections)
//   - docs/Design/caissapp/40-floor-plan-no-selection.jpg
//   - docs/Design/caissapp/41-floor-plan-table-t12-selected.jpg
//
// Tablet ≠ POS-modal. The waiter tablet renders the floor plan as a
// FULL-PAGE surface (no Dialog), with extra-large touch targets so the
// waiter can tap a table while standing. The component is a controlled
// presentational view: data (tables + occupancy) and selection are
// supplied by the host page; on table selection the host typically
// navigates to the order-entry surface.
//
// Layout (tablet portrait/landscape):
//   ┌──────────────────────────────────────────────┐
//   │ [icon] FLOOR PLAN                            │  ← header (Display font)
//   │ Tap an available table to start a new order. │  ← subtitle
//   ├──────────────────────────────────────────────┤
//   │ [ INTERIOR (n) ]   [ TERRACE (n) ]           │  ← section tabs (≥44px)
//   ├──────────────────────────────────────────────┤
//   │   [T15]      [T12]                           │  ← canvas (dotted)
//   │   [T14]      [T11]                           │
//   │   [T13]      [T10]                           │
//   ├──────────────────────────────────────────────┤
//   │ • AVAILABLE  • OCCUPIED  • RESERVED          │  ← legend
//   └──────────────────────────────────────────────┘
//
// Touch-spacing strategy:
//   - Section tabs: h-touch-comfy (56px), py-3, gap-3.
//   - Table cells: large pill/circle (h-32, w-32 / w-52) — tactile.
//   - Canvas grid: gap-8 between cells (generous spacing).
//   - All interactive elements meet 44px minimum.
//
// Sections strategy: same as POS modal — sort_order < 100 = Interior,
// >= 100 = Terrace. Backwards-compatible (interior holds everything if
// no table has sort_order ≥ 100).

import { useMemo, useState, useCallback } from 'react';
import { Home, Trees, Users } from 'lucide-react';
import type { JSX } from 'react';
import type { RestaurantTable } from '@breakery/domain';
import { cn } from '@breakery/ui';
import { TableCell, type FloorPlanTable, type TableStatus } from '../floor-plan/TableCell';

export type FloorPlanSection = 'interior' | 'terrace';

export interface FloorPlanViewProps {
  tables: RestaurantTable[];
  /** Map of tableName → occupied flag. */
  occupancy: Record<string, boolean>;
  /** Currently selected/active table (e.g. cart.tableNumber). */
  selectedTable?: string | null;
  /** Fired when the waiter taps an available table. */
  onTableSelect: (tableName: string) => void;
  /** Optional: header subtitle override. */
  subtitle?: string;
}

function bucketTables(
  tables: RestaurantTable[],
): Record<FloorPlanSection, RestaurantTable[]> {
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

export function FloorPlanView({
  tables,
  occupancy,
  selectedTable,
  onTableSelect,
  subtitle,
}: FloorPlanViewProps): JSX.Element {
  const buckets = useMemo(() => bucketTables(tables), [tables]);
  // Default to whichever section actually has tables; prefer interior if both.
  const initialSection: FloorPlanSection =
    buckets.interior.length === 0 && buckets.terrace.length > 0 ? 'terrace' : 'interior';
  const [section, setSection] = useState<FloorPlanSection>(initialSection);

  const visible = buckets[section];

  const handleTap = useCallback(
    (table: RestaurantTable): void => {
      const occupied = occupancy[table.name] === true;
      if (occupied) return; // tablet flow: cannot start a new order on an occupied table
      onTableSelect(table.name);
    },
    [occupancy, onTableSelect],
  );

  return (
    <section
      className="flex flex-col h-full bg-bg-base"
      data-testid="tablet-floor-plan"
      aria-label="Floor plan"
    >
      {/* Header */}
      <header className="px-6 py-5 flex items-start gap-4 border-b border-border-subtle bg-bg-elevated">
        <div
          aria-hidden
          className="h-12 w-12 inline-flex items-center justify-center rounded-md bg-gold-soft text-gold shrink-0"
        >
          <Users className="h-6 w-6" />
        </div>
        <div>
          <h1 className="font-display text-2xl tracking-wide text-text-primary">FLOOR PLAN</h1>
          <p className="text-text-secondary text-sm mt-1">
            {subtitle ?? 'Tap an available table to start a new order.'}
          </p>
        </div>
      </header>

      {/* Section tabs */}
      <nav
        className="px-6 py-4 flex items-center gap-3 border-b border-border-subtle bg-bg-elevated"
        aria-label="Floor sections"
      >
        <SectionTab
          icon={<Home className="h-5 w-5" aria-hidden />}
          label="Interior"
          count={buckets.interior.length}
          active={section === 'interior'}
          onClick={() => setSection('interior')}
        />
        <SectionTab
          icon={<Trees className="h-5 w-5" aria-hidden />}
          label="Terrace"
          count={buckets.terrace.length}
          active={section === 'terrace'}
          onClick={() => setSection('terrace')}
        />
      </nav>

      {/* Floor canvas */}
      <main
        className="flex-1 overflow-auto p-6"
        data-testid="tablet-floor-plan-canvas"
        aria-label={`Floor plan — ${section}`}
      >
        <div
          className={cn(
            'min-h-full rounded-xl border border-border-subtle bg-bg-elevated/40 p-8',
            'bg-[radial-gradient(circle,_rgba(201,165,87,0.08)_1px,_transparent_1px)] [background-size:18px_18px]',
          )}
        >
          {visible.length === 0 ? (
            <div className="h-full min-h-[300px] grid place-items-center text-text-muted text-sm">
              No tables configured for this section.
            </div>
          ) : (
            <div className="flex flex-wrap gap-8 justify-center items-center">
              {visible.map((t) => (
                <TableCell
                  key={t.id}
                  table={toFloorPlanTable(t, occupancy)}
                  selected={selectedTable === t.name}
                  onTap={() => handleTap(t)}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Footer legend */}
      <footer className="px-6 py-4 border-t border-border-subtle bg-bg-elevated">
        <div className="flex items-center gap-6 text-xs uppercase tracking-widest font-semibold flex-wrap">
          <Legend tone="available" label="Available" />
          <Legend tone="occupied" label="Occupied" />
          <Legend tone="reserved" label="Reserved" />
        </div>
      </footer>
    </section>
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
      data-testid={`tablet-floor-plan-section-${label.toLowerCase()}`}
      className={cn(
        // Tactile size: 44px minimum (min-h-11) with comfortable padding.
        'min-h-11 inline-flex items-center gap-3 px-5 rounded-full border text-sm font-semibold uppercase tracking-widest',
        'transition-colors duration-base motion-reduce:transition-none',
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
    <span className="inline-flex items-center gap-2">
      <span
        aria-hidden
        className={cn(
          'h-3 w-3 rounded-full ring-2 ring-offset-1 ring-offset-bg-elevated',
          tone === 'available' && 'bg-green ring-green/40',
          tone === 'occupied' && 'bg-amber-warn ring-amber-warn/40',
          tone === 'reserved' && 'bg-text-muted ring-text-muted/40',
        )}
      />
      <span className="text-text-secondary">{label}</span>
    </span>
  );
}

export default FloorPlanView;
