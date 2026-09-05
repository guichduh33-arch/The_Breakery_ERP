// apps/backoffice/src/features/inventory-movements/components/MovementsFilters.tsx
// Session 13 / Phase 2.D — filter row above MovementsTable.
// 2026-06-23 — added an Item (product typeahead) filter + period presets.
//
// ADR-027 — le filtre de section a disparu : le stock est global. Les types
// `transfer_in` / `transfer_out` restent proposés, l'enum DB les conserve pour
// l'historique et les lignes d'époque doivent rester filtrables.

import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { toLocalDateStr } from '@breakery/domain';
import { formatNumber } from '@breakery/utils';
import { listboxOptionState, useListboxKeyboard } from '@/hooks/useListboxKeyboard.js';
import { useProductsForInventory } from '@/features/inventory/hooks/useProductsForInventory.js';
import type { MovementsFilters as Filters } from '../hooks/useStockMovementsFeed.js';
import { FOCUS_RING } from '@/components/focusRing.js';

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

  const keyboard = useListboxKeyboard<(typeof options)[number]>({
    items:      options,
    open:       showList,
    getItemKey: (p) => p.id,
    onSelect:   (p) => { onSelect(p.id, p.name); setQuery(p.name); setOpen(false); },
    onClose:    () => { setOpen(false); },
  });

  // La fermeture différée survivait au démontage.
  const blurTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (blurTimer.current !== null) window.clearTimeout(blurTimer.current);
  }, []);

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
          aria-autocomplete="list"
          aria-activedescendant={keyboard.activeDescendantId}
          autoComplete="off"
          placeholder="All items"
          value={query}
          onKeyDown={keyboard.handleKeyDown}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            if (productId !== undefined && productId !== '') onSelect(undefined);
          }}
          onFocus={() => { setOpen(true); }}
          onBlur={() => { blurTimer.current = window.setTimeout(() => { setOpen(false); }, 120); }}
          className={`w-44 px-2 py-1 text-sm bg-bg-base border border-border-strong rounded placeholder:text-text-muted ${FOCUS_RING}`}
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
      {/* Le descendant actif ne déplace pas le focus : sans annonce, l'apparition
          des résultats est muette pour un lecteur d'écran. */}
      <span className="sr-only" role="status" aria-live="polite">{keyboard.statusText}</span>
      {showList && (
        <ul
          id="mvt-item-list"
          role="listbox"
          className="absolute z-20 mt-1 max-h-60 w-56 overflow-auto rounded border border-border-subtle bg-bg-elevated shadow-lg"
        >
          {options.map((p, i) => (
            // Non focalisable : la surbrillance vient du champ via
            // `aria-activedescendant` (voir useListboxKeyboard).
            <li
              key={p.id}
              role="option"
              id={keyboard.optionId(i)}
              aria-selected={keyboard.activeIndex === i}
              onMouseEnter={() => { keyboard.onOptionHover(i); }}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(p.id, p.name);
                setQuery(p.name);
                setOpen(false);
              }}
              className={`flex w-full items-baseline justify-between gap-2 px-2 py-1 text-left text-sm ${listboxOptionState(keyboard.activeIndex === i)}`}
            >
              <span className="min-w-0 truncate text-text-primary">{p.name}</span>
              <span className="shrink-0 text-xs text-text-secondary">{p.sku}</span>
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
        <label htmlFor="mvt-type" className="block text-xs uppercase text-text-secondary mb-1">Type</label>
        <select
          id="mvt-type"
          value={value.movementType ?? ''}
          onChange={(e) => { onChange({ ...value, movementType: e.target.value }); }}
          className={`h-9 px-2 text-sm bg-bg-base border border-border-strong rounded ${FOCUS_RING}`}
        >
          <option value="">All types</option>
          {MOVEMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      <div>
        <label htmlFor="mvt-from" className="block text-xs uppercase text-text-secondary mb-1">From</label>
        <input
          id="mvt-from"
          type="date" lang="id-ID"
          value={value.dateStart ?? ''}
          onChange={(e) => { onChange({ ...value, dateStart: e.target.value }); }}
          className={`h-9 px-2 text-sm bg-bg-base border border-border-strong rounded ${FOCUS_RING}`}
        />
      </div>

      <div>
        <label htmlFor="mvt-to" className="block text-xs uppercase text-text-secondary mb-1">To</label>
        <input
          id="mvt-to"
          type="date" lang="id-ID"
          value={value.dateEnd ?? ''}
          onChange={(e) => { onChange({ ...value, dateEnd: e.target.value }); }}
          className={`h-9 px-2 text-sm bg-bg-base border border-border-strong rounded ${FOCUS_RING}`}
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
                  ? 'border-gold bg-surface-4 text-text-primary'
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
        <Search className="h-3 w-3" aria-hidden /> Full range, running balance per product (cap {formatNumber(5000)} rows).
      </div>
    </div>
  );
}
