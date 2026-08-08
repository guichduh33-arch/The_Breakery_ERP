// apps/backoffice/src/features/products/components/ProductsFilters.tsx
//
// Écran 2a — barre de filtres du catalogue.
//
// Les contrôles quittent le `rounded-full` : une pile de pilules se lit comme
// une devanture, pas comme un outil. Tout passe à 34 px de haut et au rayon de
// contrôle du thème.
//
// « Columns » est un vrai réglage, pas un bouton décoratif : le catalogue porte
// douze colonnes et personne n'a besoin des douze en même temps. Le réglage est
// purement client — masquer une colonne ne change aucune requête.

import { useEffect, useRef, useState, type JSX } from 'react';
import { LayoutGrid, List, Search, SlidersHorizontal } from 'lucide-react';
import { cn } from '@breakery/ui';
import {
  PRODUCT_COLUMNS,
  type CategoryOption, type ProductColumnId, type ProductView, type ProductVariantFilter,
} from '../types.js';

const EMPTY_HIDDEN: ReadonlySet<ProductColumnId> = new Set();

const CONTROL =
  'h-[34px] rounded-sm border border-border-strong bg-bg-elevated text-[13px] text-text-primary ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold';

interface Props {
  search:           string;
  onSearch:         (value: string) => void;
  /** Id de catégorie, ou la sentinelle `'all'`. */
  categoryId:       string;
  onCategory:       (id: string) => void;
  categories:       readonly CategoryOption[];
  view:             ProductView;
  onViewChange:     (view: ProductView) => void;
  variantFilter:    ProductVariantFilter;
  onVariantFilter:  (filter: ProductVariantFilter) => void;
  hiddenColumns?:   ReadonlySet<ProductColumnId>;
  onToggleColumn?:  (id: ProductColumnId) => void;
}

export function ProductsFilters({
  search, onSearch,
  categoryId, onCategory,
  categories,
  view, onViewChange,
  variantFilter, onVariantFilter,
  hiddenColumns = EMPTY_HIDDEN, onToggleColumn,
}: Props): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[220px] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-text-subtle" aria-hidden />
        <input
          type="search"
          aria-label="Search products"
          placeholder="Search by name or SKU…"
          value={search}
          onChange={(e) => { onSearch(e.target.value); }}
          className={cn(CONTROL, 'w-full pl-9 pr-3 placeholder:text-text-muted')}
        />
      </div>

      <label htmlFor="bo-products-category" className="sr-only">Category</label>
      <select
        id="bo-products-category"
        value={categoryId}
        onChange={(e) => { onCategory(e.target.value === 'all' ? 'all' : e.target.value); }}
        className={cn(CONTROL, 'px-2.5')}
      >
        <option value="all">All categories</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>

      <label htmlFor="bo-products-variant" className="sr-only">Variant filter</label>
      <select
        id="bo-products-variant"
        data-testid="products-filter"
        value={variantFilter}
        onChange={(e) => { onVariantFilter(e.target.value as ProductVariantFilter); }}
        className={cn(CONTROL, 'px-2.5')}
      >
        <option value="all">All products</option>
        <option value="standalone">Standalone only</option>
        <option value="parents">Parents only</option>
        <option value="variants">Variants only</option>
      </select>

      <ColumnsMenu hidden={hiddenColumns} onToggle={onToggleColumn} />

      <div
        role="group"
        aria-label="View mode"
        className="inline-flex h-[34px] items-stretch overflow-hidden rounded-sm border border-border-strong bg-bg-elevated"
      >
        <ViewToggleButton label="Grid view" active={view === 'grid'} onClick={() => { onViewChange('grid'); }}>
          <LayoutGrid className="h-4 w-4" aria-hidden />
        </ViewToggleButton>
        <ViewToggleButton label="List view" active={view === 'list'} onClick={() => { onViewChange('list'); }}>
          <List className="h-4 w-4" aria-hidden />
        </ViewToggleButton>
      </div>
    </div>
  );
}

function ColumnsMenu({
  hidden, onToggle,
}: {
  hidden: ReadonlySet<ProductColumnId>;
  onToggle?: ((id: ProductColumnId) => void) | undefined;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (wrapRef.current?.contains(e.target as Node) === false) setOpen(false);
    };
    const onKeyDown = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); }}
        aria-expanded={open}
        aria-haspopup="menu"
        data-testid="products-columns-menu"
        className={cn(CONTROL, 'inline-flex items-center gap-1.5 px-3 font-medium')}
      >
        <SlidersHorizontal className="h-[15px] w-[15px] text-text-muted" aria-hidden />
        Columns
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+6px)] z-40 w-52 rounded-xl border border-border-strong bg-surface-3 py-1.5 shadow-[0_18px_40px_rgba(28,23,18,0.20)]"
        >
          {PRODUCT_COLUMNS.map((c) => (
            <label
              key={c.id}
              className="flex cursor-pointer items-center gap-2.5 px-3.5 py-1.5 text-[13px] text-text-primary hover:bg-surface-4"
            >
              <input
                type="checkbox"
                checked={!hidden.has(c.id)}
                onChange={() => { onToggle?.(c.id); }}
                className="h-3.5 w-3.5 accent-gold"
              />
              {c.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function ViewToggleButton({
  label, active, onClick, children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex w-8 items-center justify-center transition-colors duration-fast',
        active ? 'bg-gold-soft text-gold' : 'text-text-muted hover:text-text-primary',
      )}
    >
      {children}
    </button>
  );
}
