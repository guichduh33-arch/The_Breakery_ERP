// apps/backoffice/src/features/inventory-movements/components/MovementsFilters.tsx
// Session 13 / Phase 2.D — filter row above MovementsTable.

import { Search } from 'lucide-react';
import { useSections } from '@/features/inventory-transfers/hooks/useSections.js';
import type { MovementsFilters as Filters } from '../hooks/useStockMovementsFeed.js';

const MOVEMENT_TYPES = [
  'sale','sale_void','purchase','purchase_return','incoming',
  'transfer_in','transfer_out',
  'production_in','production_out',
  'adjustment','adjustment_in','adjustment_out',
  'opname_in','opname_out',
  'waste','reservation_hold','reservation_release',
];

export interface MovementsFiltersProps {
  value:    Filters;
  onChange: (f: Filters) => void;
}

export function MovementsFiltersBar({ value, onChange }: MovementsFiltersProps) {
  const sections = useSections();

  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-border-subtle pb-3">
      <div>
        <label htmlFor="mvt-section" className="block text-xs uppercase text-text-secondary mb-1">Section</label>
        <select
          id="mvt-section"
          value={value.sectionId ?? ''}
          onChange={(e) => { onChange({ ...value, sectionId: e.target.value }); }}
          className="px-2 py-1 text-sm bg-bg-base border border-border-subtle rounded"
        >
          <option value="">All sections</option>
          {(sections.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="mvt-type" className="block text-xs uppercase text-text-secondary mb-1">Type</label>
        <select
          id="mvt-type"
          value={value.movementType ?? ''}
          onChange={(e) => { onChange({ ...value, movementType: e.target.value }); }}
          className="px-2 py-1 text-sm bg-bg-base border border-border-subtle rounded"
        >
          <option value="">All types</option>
          {MOVEMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      <div>
        <label htmlFor="mvt-from" className="block text-xs uppercase text-text-secondary mb-1">From</label>
        <input
          id="mvt-from"
          type="date"
          value={value.dateStart ?? ''}
          onChange={(e) => { onChange({ ...value, dateStart: e.target.value }); }}
          className="px-2 py-1 text-sm bg-bg-base border border-border-subtle rounded"
        />
      </div>

      <div>
        <label htmlFor="mvt-to" className="block text-xs uppercase text-text-secondary mb-1">To</label>
        <input
          id="mvt-to"
          type="date"
          value={value.dateEnd ?? ''}
          onChange={(e) => { onChange({ ...value, dateEnd: e.target.value }); }}
          className="px-2 py-1 text-sm bg-bg-base border border-border-subtle rounded"
        />
      </div>

      <button
        type="button"
        onClick={() => { onChange({}); }}
        className="text-sm text-text-secondary hover:text-text-primary underline pb-1"
      >
        Clear
      </button>

      <div className="ml-auto text-xs text-text-secondary self-center inline-flex items-center gap-1">
        <Search className="h-3 w-3" aria-hidden /> Cursor-paginated, 50 rows / page (cap 200).
      </div>
    </div>
  );
}
