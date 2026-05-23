// apps/backoffice/src/features/products/components/ProductsFilters.tsx
//
// Session 14 / Phase 4.B — Filter strip on the Products page:
//   - search input (full width)
//   - category dropdown
//   - grid/list view toggle
// Mirrors `product page.jpg`.

import { LayoutGrid, List, Search } from 'lucide-react';
import type { JSX } from 'react';
import { Input, cn } from '@breakery/ui';
import type { CategoryOption, ProductView, ProductVariantFilter } from '../types.js';

interface Props {
  search:           string;
  onSearch:         (value: string) => void;
  categoryId:       string | 'all';
  onCategory:       (id: string | 'all') => void;
  categories:       ReadonlyArray<CategoryOption>;
  view:             ProductView;
  onViewChange:     (view: ProductView) => void;
  /** Session 27c — variant grouping filter (all / standalone / parents / variants). */
  variantFilter:    ProductVariantFilter;
  onVariantFilter:  (filter: ProductVariantFilter) => void;
}

export function ProductsFilters({
  search, onSearch,
  categoryId, onCategory,
  categories,
  view, onViewChange,
  variantFilter, onVariantFilter,
}: Props): JSX.Element {
  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden />
        <Input
          aria-label="Search products"
          placeholder="Search by name or SKU..."
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          className="rounded-full pl-9"
        />
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex-1">
          <label htmlFor="bo-products-category" className="sr-only">Category</label>
          <select
            id="bo-products-category"
            value={categoryId}
            onChange={(e) => onCategory(e.target.value === 'all' ? 'all' : e.target.value)}
            className="h-10 w-full rounded-full border border-border-subtle bg-bg-elevated px-4 text-sm text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
          >
            <option value="all">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div className="md:w-48">
          <label htmlFor="bo-products-variant" className="sr-only">Variant filter</label>
          <select
            id="bo-products-variant"
            data-testid="products-filter"
            value={variantFilter}
            onChange={(e) => onVariantFilter(e.target.value as ProductVariantFilter)}
            className="h-10 w-full rounded-full border border-border-subtle bg-bg-elevated px-4 text-sm text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
          >
            <option value="all">All products</option>
            <option value="standalone">Standalone only</option>
            <option value="parents">Parents only</option>
            <option value="variants">Variants only</option>
          </select>
        </div>

        <div
          role="group"
          aria-label="View mode"
          className="inline-flex items-center gap-1 rounded-full border border-border-subtle bg-bg-elevated p-1"
        >
          <ViewToggleButton
            label="Grid view"
            active={view === 'grid'}
            onClick={() => onViewChange('grid')}
          >
            <LayoutGrid className="h-4 w-4" aria-hidden />
          </ViewToggleButton>
          <ViewToggleButton
            label="List view"
            active={view === 'list'}
            onClick={() => onViewChange('list')}
          >
            <List className="h-4 w-4" aria-hidden />
          </ViewToggleButton>
        </div>
      </div>
    </div>
  );
}

interface ViewToggleButtonProps {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function ViewToggleButton({ label, active, onClick, children }: ViewToggleButtonProps): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'h-8 w-8 inline-flex items-center justify-center rounded-full transition-colors duration-fast',
        active ? 'bg-gold-soft text-gold' : 'text-text-muted hover:text-text-primary',
      )}
    >
      {children}
    </button>
  );
}
