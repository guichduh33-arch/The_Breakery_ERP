// apps/backoffice/src/features/settings/components/ShowcaseProductPicker.tsx
//
// ADR-023 déc. 2 — le choix d'un produit à mettre en vitrine.
//
// Même parti que le sélecteur des combos, dont il reprend le bornage : le
// catalogue visible en caisse compte ~150 entrées, les rendre toutes remplirait
// la page d'arrêts de tabulation invisibles. On borne, et on dit ce qu'on
// cache. L'univers, lui, est plus étroit — voir `useShowcaseCandidates`.

import { useMemo, useState, type JSX } from 'react';
import { Currency } from '@breakery/ui';
import { FOCUS_RING } from '@/components/focusRing.js';
import {
  useShowcaseCandidates,
  type ShowcaseCandidate,
} from '../hooks/useShowcaseCandidates.js';
import { formatCurrency } from '@breakery/utils';

interface Props {
  /** Produits déjà retenus — ils sortent de la liste. */
  excludeIds?: string[];
  onPick: (product: ShowcaseCandidate) => void;
  onClose: () => void;
}

const MAX_ROWS = 25;

export function ShowcaseProductPicker({
  excludeIds = [],
  onPick,
  onClose,
}: Props): JSX.Element {
  const [search, setSearch] = useState('');
  const { data, isLoading, isError } = useShowcaseCandidates();

  const excludeKey = excludeIds.join(',');
  const { rows, matchCount } = useMemo(() => {
    const query = search.trim().toLowerCase();
    const excluded = new Set(excludeKey === '' ? [] : excludeKey.split(','));
    const matches = (data ?? []).filter(
      (p) =>
        !excluded.has(p.id) &&
        (p.name.toLowerCase().includes(query) || p.sku.toLowerCase().includes(query)),
    );
    return { rows: matches.slice(0, MAX_ROWS), matchCount: matches.length };
  }, [data, search, excludeKey]);

  const hiddenCount = matchCount - rows.length;

  return (
    <div
      className="rounded-lg border border-border-subtle bg-bg-elevated shadow-lg p-3 flex flex-col gap-2"
      data-testid="showcase-product-picker"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
          Add to showcase
        </span>
        <button
          type="button"
          onClick={onClose}
          className={`text-text-muted hover:text-text-primary text-lg leading-none ${FOCUS_RING}`}
          aria-label="Close picker"
        >
          ×
        </button>
      </div>
      <input
        type="text"
        placeholder="Search by name or SKU…"
        value={search}
        onChange={(e) => { setSearch(e.target.value); }}
        className={`w-full px-2 py-1.5 text-sm bg-bg-base border border-border-subtle rounded placeholder:text-text-muted ${FOCUS_RING}`}
        data-testid="showcase-picker-search"
        autoFocus
      />

      {isLoading && <p className="text-sm text-text-muted py-2">Loading products…</p>}
      {isError && <p className="text-sm text-red py-2">Failed to load products.</p>}
      {!isLoading && !isError && matchCount === 0 && (
        <p className="text-sm text-text-muted py-2" role="status">
          No product on sale matches.
        </p>
      )}
      {!isLoading && !isError && matchCount > 0 && (
        <ul
          className="overflow-auto max-h-48 divide-y divide-border-subtle border border-border-subtle rounded text-sm"
          role="listbox"
          aria-label="Products on sale"
        >
          {rows.map((p) => (
            <li key={p.id} role="option" aria-selected={false}>
              <button
                type="button"
                onClick={() => { onPick(p); }}
                className={`w-full text-left px-3 py-2 hover:bg-surface-4 flex items-center justify-between gap-2 ${FOCUS_RING}`}
                data-testid={`showcase-picker-row-${p.id}`}
              >
                <span className="flex-1 min-w-0 truncate text-text-primary">{p.name}</span>
                <span className="text-xs text-text-muted font-mono shrink-0">{p.sku}</span>
                <Currency format={formatCurrency}
                  amount={p.retail_price}
                  className="text-xs text-text-secondary shrink-0"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
      {!isLoading && !isError && hiddenCount > 0 && (
        <p className="text-xs text-text-muted" role="status" data-testid="showcase-picker-overflow">
          Showing {rows.length} of{' '}
          <span className="font-mono tabular-nums">{matchCount}</span> matches — refine your
          search.
        </p>
      )}
    </div>
  );
}
