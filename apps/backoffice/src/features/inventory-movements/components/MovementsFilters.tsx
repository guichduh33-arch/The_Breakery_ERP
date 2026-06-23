// apps/backoffice/src/features/inventory-movements/components/MovementsFilters.tsx
// Session 13 / Phase 2.D — filter row above MovementsTable.
// 2026-06-23 — added an Item (product typeahead) filter + period presets.

import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { toLocalDateStr } from '@breakery/domain';
import { useSections } from '@/features/inventory-transfers/hooks/useSections.js';
import { useProductsForInventory } from '@/features/inventory/hooks/useProductsForInventory.js';
import type { MovementsFilters as Filters } from '../hooks/useStockMovementsFeed.js';

const MOVEMENT_TYPES = [
  'sale','sale_void','purchase','purchase_return','incoming',
  'transfer_in','transfer_out',
  'production_in','production_out',
  'adjustment','adjustment_in','adjustment_out',
  'opname_in','opname_out',
  'waste','reservation_hold','reservation_release',
];

// --- Period presets -------------------------------------------------------
function todayStr(): string { return toLocalDateStr(new Date()); }
function daysAgoStr(n: number): string { return toLocalDateStr(new Date(Date.now() - n * 86_400_000)); }
function monthStartStr(): string {
  const d = new Date();
  return toLocalDateStr(new Date(d.getFullYear(), d.getMonth(), 1));
}

interface Preset { key: string; label: string; range: () => { dateStart: string; dateEnd: string }; }
const PRESETS: Preset[] = [
  { key: 'today', label: 'Today',      range: () => ({ dateStart: todayStr(),      dateEnd: todayStr() }) },
  { key: '7d',    label: '7d',         range: () => ({ dateStart: daysAgoStr(6),   dateEnd: todayStr() }) },
  { key: '30d',   label: '30d',        range: () => ({ dateStart: daysAgoStr(29),  dateEnd: todayStr() }) },
  { key: 'month', label: 'This month', range: () => ({ dateStart: monthStartStr(), dateEnd: todayStr() }) },
];

// --- Item (product) typeahead filter -------------------------------------
function ItemFilter({ productId, onSelect }: {
  productId: string | undefined;
  onSelect: (id: string | undefined, name?: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const results = useProductsForInventory(query);

  // Reset the visible text when the filter is cleared externally (Clear button).
  useEffect(() => { if (productId === undefined || productId === '') setQuery(''); }, [productId]);

  const options = results.data ?? [];
  const showList = open && query.trim().length >= 2 && options.length > 0;

  return (
    <div className="relative">
      <label htmlFor="mvt-item" className="block text-xs uppercase text-text-secondary mb-1">Item</label>
      <div className="flex items-center">
        <input
          id="mvt-item"
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls="mvt-item-list"
          autoComplete="off"
          placeholder="All items"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            if (productId !== undefined && productId !== '') onSelect(undefined);
          }}
          onFocus={() => { setOpen(true); }}
          onBlur={() => { window.setTimeout(() => { setOpen(false); }, 120); }}
          className="w-44 px-2 py-1 text-sm bg-bg-base border border-border-subtle rounded"
        />
        {(productId !== undefined && productId !== '') && (
          <button
            type="button"
            aria-label="Clear item filter"
            onClick={() => { onSelect(undefined); setQuery(''); }}
            className="-ml-6 text-text-secondary hover:text-text-primary"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
      {showList && (
        <ul
          id="mvt-item-list"
          role="listbox"
          className="absolute z-20 mt-1 max-h-60 w-56 overflow-auto rounded border border-border-subtle bg-bg-elevated shadow-lg"
        >
          {options.map((p) => (
            <li key={p.id} role="option" aria-selected={p.id === productId}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(p.id, p.name);
                  setQuery(p.name);
                  setOpen(false);
                }}
                className="flex w-full items-baseline justify-between gap-2 px-2 py-1 text-left text-sm hover:bg-bg-base"
              >
                <span className="text-text-primary">{p.name}</span>
                <span className="text-xs text-text-secondary">{p.sku}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface MovementsFiltersProps {
  value:    Filters;
  onChange: (f: Filters) => void;
}

export function MovementsFiltersBar({ value, onChange }: MovementsFiltersProps) {
  const sections = useSections();

  const activePreset = PRESETS.find((p) => {
    const r = p.range();
    return r.dateStart === value.dateStart && r.dateEnd === value.dateEnd;
  });

  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-border-subtle pb-3">
      <ItemFilter
        productId={value.productId}
        onSelect={(id, _name) => {
          const next: Filters = { ...value };
          if (id !== undefined && id !== '') next.productId = id;
          else delete next.productId;
          onChange(next);
        }}
      />

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

      <div role="group" aria-label="Period presets" className="flex items-center gap-1 pb-1">
        {PRESETS.map((p) => {
          const isActive = activePreset?.key === p.key;
          return (
            <button
              key={p.key}
              type="button"
              aria-pressed={isActive}
              onClick={() => { onChange({ ...value, ...p.range() }); }}
              className={`rounded border px-2 py-1 text-xs ${
                isActive
                  ? 'border-gold bg-gold/10 text-text-primary'
                  : 'border-border-subtle text-text-secondary hover:text-text-primary'
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => { onChange({}); }}
        className="text-sm text-text-secondary hover:text-text-primary underline pb-1"
      >
        Clear
      </button>

      <div className="ml-auto text-xs text-text-secondary self-center inline-flex items-center gap-1">
        <Search className="h-3 w-3" aria-hidden /> Full range, running balance per product (cap 5,000 rows).
      </div>
    </div>
  );
}
