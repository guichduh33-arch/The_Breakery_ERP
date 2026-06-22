// apps/backoffice/src/pages/inventory/ProductionPage.tsx
//
// Production page — station-based production entry.
//
// Layout: a row of production-station tabs (sections kind='production') + a
// day navigator, then a 2-column board:
//   - left  : Production Entry card (multi-row, atomic, backdatable)
//   - right : PRODUCED / WASTE KPI tiles + the day's production log
//
// Products are strictly filtered per station via product_sections (assign them
// in the product editor → Stations tab). Submitting calls
// record_batch_production_v2; the entry's date/time may be backdated.

import { useEffect, useMemo, useState, type JSX } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { useSections } from '@/features/inventory-transfers/hooks/useSections.js';
import { ProductionEntryCard } from '@/features/inventory-production/components/ProductionEntryCard.js';
import { ProductionTodayPanel } from '@/features/inventory-production/components/ProductionTodayPanel.js';

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatDay(d: Date): string {
  return d
    .toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
    .toUpperCase();
}

export default function ProductionPage(): JSX.Element {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead = hasPermission('inventory.read');
  const canCreate = hasPermission('inventory.production.create');

  const sections = useSections();
  const stations = useMemo(
    () => (sections.data ?? []).filter((s) => s.kind === 'production'),
    [sections.data],
  );

  const [activeId, setActiveId] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());

  // Default to the first station once they load.
  useEffect(() => {
    if (activeId === '' && stations.length > 0) {
      setActiveId(stations[0]!.id);
    }
  }, [stations, activeId]);

  function shiftDay(delta: number): void {
    setSelectedDate((prev) => {
      const next = new Date(prev);
      next.setDate(next.getDate() + delta);
      return next;
    });
  }

  if (!canRead) {
    return <div className="text-text-secondary">You do not have permission to view production.</div>;
  }

  const activeStation = stations.find((s) => s.id === activeId) ?? null;
  const today = new Date();

  return (
    <div className="space-y-6">
      {/* Station tabs + day navigator */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <nav role="tablist" aria-label="Production stations" className="flex flex-wrap gap-2">
          {stations.map((s) => {
            const selected = s.id === activeId;
            return (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActiveId(s.id)}
                data-testid={`station-tab-${s.code}`}
                className={cn(
                  'rounded-full border px-5 py-2 text-xs font-semibold uppercase tracking-widest transition-colors',
                  selected
                    ? 'border-gold bg-gold-soft text-gold'
                    : 'border-border-subtle text-text-muted hover:text-text-primary',
                )}
              >
                {s.name}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-2 rounded-full border border-border-subtle px-2 py-1">
          <button
            type="button"
            onClick={() => shiftDay(-1)}
            aria-label="Previous day"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-text-muted hover:text-text-primary"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <div className="min-w-[8rem] text-center">
            <div className="text-xs font-semibold uppercase tracking-widest text-gold">
              {isSameDay(selectedDate, today) ? 'Today' : selectedDate.toLocaleDateString('en-US', { weekday: 'short' })}
            </div>
            <div className="text-[11px] text-text-muted" data-testid="production-selected-date">
              {formatDay(selectedDate)}
            </div>
          </div>
          <button
            type="button"
            onClick={() => shiftDay(1)}
            aria-label="Next day"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-text-muted hover:text-text-primary"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      {stations.length === 0 ? (
        <div className="rounded-lg border border-border-subtle p-8 text-center text-sm text-text-muted">
          No production stations defined.
        </div>
      ) : activeStation === null ? null : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            {canCreate ? (
              <ProductionEntryCard
                sectionId={activeStation.id}
                sectionName={activeStation.name}
                selectedDate={selectedDate}
              />
            ) : (
              <div className="rounded-lg border border-border-subtle p-8 text-center text-sm text-text-muted">
                You do not have permission to record production.
              </div>
            )}
          </div>
          <div className="lg:col-span-1">
            <ProductionTodayPanel sectionId={activeStation.id} selectedDate={selectedDate} />
          </div>
        </div>
      )}
    </div>
  );
}
