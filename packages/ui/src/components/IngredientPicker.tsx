// packages/ui/src/components/IngredientPicker.tsx
//
// Session 15 / Phase 3.A — IngredientPicker autocomplete.
//
// Combobox-pattern search picker backing RecipeEditor / ProductionForm
// material selection. Self-contained debounce (200ms) ; consumes a
// caller-supplied `searchFn` so this package stays IO-free.
//
// Decisions :
// - D8 (Spec 2026-05-15) : kind ∈ {raw, semi_finished, sub_recipe, all}.
// - showCostPreview is opt-in and requires a `costGraph` (passed by the
//   caller). The preview uses `@breakery/domain` `tryCalculateRecipeCost`
//   so cycle / depth errors are rendered inline instead of thrown.
// - Tabs render only when `showKindTabs` is true (default) — when only one
//   kind is acceptable (e.g. embedded picker forcing raw), hide them.
// - ARIA combobox pattern : aria-expanded, aria-activedescendant, role=listbox
//   on the result list, role=option on each row.

import { useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent } from 'react';
import {
  tryCalculateRecipeCost,
  type RecipeGraph,
  type RecipeCostBreakdownItem,
} from '@breakery/domain';
import { cn } from '../lib/cn.js';
import { Input } from '../primitives/Input.js';
import { Badge } from '../primitives/Badge.js';

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export type IngredientKind = 'raw' | 'semi_finished' | 'sub_recipe' | 'all';

export interface IngredientSearchResult {
  product_id:    string;
  sku:           string;
  name:          string;
  unit:          string;
  cost_price:    number;
  current_stock: number;
  kind:          'raw' | 'semi_finished' | 'sub_recipe';
  has_recipe:    boolean;
}

export type IngredientSearchFn = (
  query: string,
  kind: IngredientKind,
) => Promise<IngredientSearchResult[]>;

export interface IngredientPickerProps {
  /** Currently selected product id (null = none). */
  value: string | null;
  /** Fires when a row is selected (or cleared via Escape on empty input). */
  onChange: (productId: string | null, row: IngredientSearchResult | null) => void;
  /** Backing search function — caller wires this to `useIngredientSearch`. */
  searchFn: IngredientSearchFn;
  /** Restrict picker to a subset. Default 'all'. */
  kind?: IngredientKind;
  /** Exclude these product IDs from results (typically the parent product itself). */
  excludeIds?: string[];
  /** Show a live cost preview pane for the highlighted row (sub_recipe only). */
  showCostPreview?: boolean;
  /** Required when `showCostPreview` is true to drive the domain calculator. */
  costGraph?: RecipeGraph;
  placeholder?: string;
  disabled?: boolean;
  /** Show the kind tabs (All / Raw / Semi / Sub). Default true. */
  showKindTabs?: boolean;
  /** Optional id for the input — useful for aria-labelledby. */
  inputId?: string;
  /** Optional className for the outer wrapper. */
  className?: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Internals
// ──────────────────────────────────────────────────────────────────────────────

const DEBOUNCE_MS = 200;
const MIN_QUERY_LEN = 2;

const KIND_TABS: readonly { value: IngredientKind; label: string }[] = [
  { value: 'all',           label: 'All' },
  { value: 'raw',           label: 'Raw' },
  { value: 'semi_finished', label: 'Semi-finished' },
  { value: 'sub_recipe',    label: 'Sub-recipe' },
];

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

function formatCurrency(n: number): string {
  if (!Number.isFinite(n)) return '–';
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(n);
}

function kindBadgeVariant(
  kind: IngredientSearchResult['kind'],
): 'default' | 'secondary' | 'outline' {
  if (kind === 'sub_recipe')    return 'default';
  if (kind === 'semi_finished') return 'secondary';
  return 'outline';
}

function kindLabel(kind: IngredientSearchResult['kind']): string {
  if (kind === 'sub_recipe')    return 'Sub-recipe';
  if (kind === 'semi_finished') return 'Semi-finished';
  return 'Raw';
}

// ──────────────────────────────────────────────────────────────────────────────
// Cost preview pane
// ──────────────────────────────────────────────────────────────────────────────

function CostPreview({
  row,
  graph,
}: {
  row: IngredientSearchResult;
  graph: RecipeGraph;
}): JSX.Element {
  const result = useMemo(
    () => tryCalculateRecipeCost(graph, row.product_id),
    [graph, row.product_id],
  );

  if (!result.ok) {
    return (
      <div className="text-xs text-text-secondary">
        <p className="font-semibold text-text-primary mb-1">Cost preview</p>
        <p className="text-red">Unable to compute: {result.error.message}</p>
      </div>
    );
  }

  const top: RecipeCostBreakdownItem[] = [...result.value.breakdown]
    .sort((a, b) => b.subtotal - a.subtotal)
    .slice(0, 3);

  return (
    <div className="text-xs">
      <p className="font-semibold text-text-primary mb-1">Cost preview</p>
      <p className="text-text-secondary mb-2">
        Total : <span className="font-semibold text-text-primary">
          {formatCurrency(result.value.cost_per_unit)}
        </span>{' '}
        / {row.unit}
      </p>
      {top.length === 0 ? (
        <p className="text-text-muted">No breakdown available.</p>
      ) : (
        <ul className="space-y-1">
          {top.map((item) => (
            <li key={item.material_id} className="flex justify-between gap-2">
              <span className="truncate text-text-secondary">{item.material_name}</span>
              <span className="text-text-primary tabular-nums">
                {formatCurrency(item.subtotal)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────────────

export function IngredientPicker({
  value,
  onChange,
  searchFn,
  kind: kindProp = 'all',
  excludeIds,
  showCostPreview = false,
  costGraph,
  placeholder = 'Search ingredient or sub-recipe…',
  disabled = false,
  showKindTabs = true,
  inputId,
  className,
}: IngredientPickerProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [activeKind, setActiveKind] = useState<IngredientKind>(kindProp);
  const [results, setResults] = useState<IngredientSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState<number>(-1);
  const [hoverIdx, setHoverIdx] = useState<number>(-1);
  const [open, setOpen] = useState(false);
  const reqIdRef = useRef(0);

  const debouncedQuery = useDebouncedValue(query, DEBOUNCE_MS);

  // Reset active kind when the prop changes.
  useEffect(() => {
    setActiveKind(kindProp);
  }, [kindProp]);

  // Effective kind : if showKindTabs is false, the prop wins ; otherwise the
  // user-driven tab selection wins (initialized to the prop).
  const effectiveKind: IngredientKind = showKindTabs ? activeKind : kindProp;

  // Search effect.
  useEffect(() => {
    let aborted = false;
    const trimmed = debouncedQuery.trim();
    if (trimmed.length > 0 && trimmed.length < MIN_QUERY_LEN) {
      setResults([]);
      setIsSearching(false);
      return () => { aborted = true; };
    }
    reqIdRef.current += 1;
    const myId = reqIdRef.current;
    setIsSearching(true);
    void (async () => {
      try {
        const rows = await searchFn(trimmed, effectiveKind);
        if (aborted || myId !== reqIdRef.current) return;
        const filtered = excludeIds && excludeIds.length > 0
          ? rows.filter((r) => !excludeIds.includes(r.product_id))
          : rows;
        setResults(filtered);
        setHighlightIdx(filtered.length > 0 ? 0 : -1);
      } catch {
        if (aborted || myId !== reqIdRef.current) return;
        setResults([]);
        setHighlightIdx(-1);
      } finally {
        if (!aborted && myId === reqIdRef.current) {
          setIsSearching(false);
        }
      }
    })();
    return () => { aborted = true; };
  }, [debouncedQuery, effectiveKind, searchFn, excludeIds]);

  // Counts shown on tabs : derived from current results. The "All" tab counts
  // include every result ; per-kind tabs count results of that kind.
  const counts = useMemo(() => {
    const c = { all: results.length, raw: 0, semi_finished: 0, sub_recipe: 0 };
    for (const r of results) {
      c[r.kind] = (c[r.kind] ?? 0) + 1;
    }
    return c;
  }, [results]);

  function commitSelection(idx: number): void {
    const row = results[idx];
    if (!row) return;
    onChange(row.product_id, row);
    setOpen(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (disabled) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (results.length === 0) return;
      setOpen(true);
      setHighlightIdx((i) => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (results.length === 0) return;
      setOpen(true);
      setHighlightIdx((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      if (highlightIdx >= 0 && highlightIdx < results.length) {
        e.preventDefault();
        commitSelection(highlightIdx);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (query.length > 0) {
        setQuery('');
        setHighlightIdx(-1);
      } else {
        setOpen(false);
        if (value !== null) onChange(null, null);
      }
    }
  }

  const listboxId = useMemo(
    () => `ingredient-picker-list-${Math.random().toString(36).slice(2, 9)}`,
    [],
  );
  const activeOptionId =
    highlightIdx >= 0 && highlightIdx < results.length
      ? `${listboxId}-opt-${highlightIdx}`
      : undefined;

  // Cost preview applies to whichever row is "focused" (hover takes priority).
  const previewIdx = hoverIdx >= 0 ? hoverIdx : highlightIdx;
  const previewRow = previewIdx >= 0 ? results[previewIdx] : undefined;
  const showPreviewPane =
    showCostPreview &&
    !!costGraph &&
    !!previewRow &&
    previewRow.kind === 'sub_recipe';

  const showResultPanel =
    open && (results.length > 0 || (query.trim().length >= MIN_QUERY_LEN && !isSearching));

  return (
    <div className={cn('relative w-full', className)}>
      <div role="combobox"
           aria-expanded={open}
           aria-haspopup="listbox"
           aria-controls={listboxId}
           aria-activedescendant={activeOptionId}>
        <Input
          id={inputId}
          type="text"
          value={query}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          aria-autocomplete="list"
          aria-label="Search ingredient"
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // Small delay so an option click can register before we close.
            setTimeout(() => setOpen(false), 150);
          }}
          onKeyDown={onKeyDown}
        />
      </div>

      {showKindTabs && (
        <div role="tablist" className="mt-2 flex gap-1">
          {KIND_TABS.map((tab) => {
            const isActive = effectiveKind === tab.value;
            const count =
              tab.value === 'all'
                ? counts.all
                : tab.value === 'raw'
                  ? counts.raw
                  : tab.value === 'semi_finished'
                    ? counts.semi_finished
                    : counts.sub_recipe;
            return (
              <button
                key={tab.value}
                role="tab"
                type="button"
                aria-selected={isActive}
                disabled={disabled}
                className={cn(
                  'px-3 py-1 text-xs rounded-md border transition-colors',
                  isActive
                    ? 'border-gold bg-gold text-bg-base'
                    : 'border-border-subtle bg-bg-elevated text-text-secondary hover:bg-bg-overlay',
                )}
                onClick={() => setActiveKind(tab.value)}
              >
                {tab.label}
                {results.length > 0 && (
                  <span className="ml-2 tabular-nums">{count}</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {showResultPanel && (
        <div className="absolute z-20 mt-2 w-full rounded-md border border-border-subtle bg-bg-elevated shadow-lg flex">
          <ul
            id={listboxId}
            role="listbox"
            className={cn(
              'max-h-72 overflow-y-auto py-1',
              showPreviewPane ? 'w-2/3' : 'w-full',
            )}
          >
            {results.length === 0 ? (
              <li className="px-3 py-2 text-sm text-text-secondary">No results</li>
            ) : (
              results.map((row, idx) => {
                const isHighlight = idx === highlightIdx;
                return (
                  <li
                    key={row.product_id}
                    id={`${listboxId}-opt-${idx}`}
                    role="option"
                    aria-selected={isHighlight}
                    onMouseEnter={() => { setHoverIdx(idx); setHighlightIdx(idx); }}
                    onMouseLeave={() => setHoverIdx(-1)}
                    onMouseDown={(e) => { e.preventDefault(); commitSelection(idx); }}
                    className={cn(
                      'flex items-center justify-between gap-3 px-3 py-2 text-sm cursor-pointer',
                      isHighlight ? 'bg-bg-overlay' : 'hover:bg-bg-overlay',
                      value === row.product_id && 'font-semibold',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-text-primary">{row.name}</p>
                      <p className="truncate text-xs text-text-secondary">
                        {row.sku} · {row.unit} · stock {row.current_stock}
                      </p>
                    </div>
                    <Badge variant={kindBadgeVariant(row.kind)}>
                      {kindLabel(row.kind)}
                    </Badge>
                  </li>
                );
              })
            )}
          </ul>
          {showPreviewPane && previewRow && costGraph && (
            <aside className="w-1/3 border-l border-border-subtle p-3 bg-bg-elevated">
              <CostPreview row={previewRow} graph={costGraph} />
            </aside>
          )}
        </div>
      )}
    </div>
  );
}
