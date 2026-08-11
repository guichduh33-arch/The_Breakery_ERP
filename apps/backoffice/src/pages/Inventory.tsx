// apps/backoffice/src/pages/Inventory.tsx
//
// Liste de stock du back-office — instance de l'archétype LIST (ADR-024).
//
// Ce que la refonte change, et pourquoi :
//   · La bande de tuiles KPI disparaît. Trois des quatre tuiles ne répondaient
//     à aucune question — le nombre de lignes affichées se compte à l'œil, le
//     nombre de filtres actifs redit ce que l'utilisateur vient de faire — et
//     la quatrième ne comptait que la page courante. Elles cèdent la place à
//     des compteurs qui SONT les filtres (`ListCounterStrip`).
//   · Le bloc « Filters » carté disparaît : une carte bordée, un intertitre et
//     ~88 px de hauteur pour trois contrôles. Recherche et catégorie tiennent
//     dans une ligne, et le troisième contrôle — « low stock only » — est
//     devenu un compteur.
//   · La table à la main cède au `DataTable` partagé, qui apporte `scope="col"`,
//     `aria-sort`, le squelette de chargement, l'état vide et un pied TOUJOURS
//     rendu — « 0 of 318 » est une information, un pied absent n'en est pas une.
//   · Le titre passe par `PageHeader`, source unique du bandeau de titre.
//   · Les trois actions du bandeau prennent les classes de bouton de barre
//     (32 px). Elles mélangeaient auparavant deux familles de hauteurs
//     différentes dans la même rangée.

import { Plus, Truck, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input, Select } from '@breakery/ui';
import { formatIdr } from '@breakery/utils';
import { DataTable, type DataTableColumn } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { PageHeader } from '@/components/PageHeader.js';
import { ListCounterStrip, type ListCounter } from '@/components/ListCounterStrip.js';
import { TOOLBAR_BTN_PRIMARY, TOOLBAR_BTN_SECONDARY } from '@/components/toolbarButton.js';
import { AdjustModal } from '@/features/inventory/components/AdjustModal.js';
import { WasteModal } from '@/features/inventory/components/WasteModal.js';
import { StockRowActions } from '@/features/inventory/components/StockRowActions.js';
import { LowStockBadge } from '@/features/inventory/components/LowStockBadge.js';
import {
  useStockLevels,
  type StockBucket,
  type StockLevelRow as Row,
  type StockLevelsFilters,
} from '@/features/inventory/hooks/useStockLevels.js';
import { useStockCounters } from '@/features/inventory/hooks/useStockCounters.js';
import { useInventoryReferenceData } from '@/features/inventory/hooks/useInventoryReferenceData.js';

const PAGE_SIZE = 50;

type ModalState =
  | { kind: 'none' }
  | { kind: 'adjust';  product?: Row }
  | { kind: 'waste';   product?: Row };

/** Jour métier : le fuseau est posé pour toute la base (Asia/Makassar). */
function formatLastMovement(iso: string | null): string {
  if (iso === null) return '—';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

export default function InventoryPage() {
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead    = hasPermission('inventory.read');
  const canAdjust  = hasPermission('inventory.adjust');
  // Q3 (audit 2026-07-27) : receive_stock_v1 droppée — la réception valorisée
  // passe par le flux achat compté (/inventory/incoming, gate purchasing.po.create).
  const canReceive = hasPermission('purchasing.po.create');
  const canWaste   = hasPermission('inventory.waste');

  const [search,     setSearch    ] = useState<string>('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [bucket,     setBucket    ] = useState<StockBucket>('all');
  const [page,       setPage      ] = useState<number>(0);
  const [modal,      setModal     ] = useState<ModalState>({ kind: 'none' });

  const filters = useMemo<StockLevelsFilters>(
    () => ({
      ...(search     !== '' ? { search }     : {}),
      ...(categoryId !== '' ? { categoryId } : {}),
      bucket,
      limit:  PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [search, categoryId, bucket, page],
  );

  // ADR-024 déc. 2 — les compteurs suivent la recherche et la catégorie, JAMAIS
  // le panier actif : sinon la bande n'annoncerait que le panier sélectionné et
  // cesserait d'être un moyen d'en changer.
  const counterFilters = useMemo(
    () => ({
      ...(search     !== '' ? { search }     : {}),
      ...(categoryId !== '' ? { categoryId } : {}),
    }),
    [search, categoryId],
  );

  const list     = useStockLevels(filters);
  const counters = useStockCounters(counterFilters);
  const refData  = useInventoryReferenceData();

  const c = counters.data;
  const pageRows = useMemo(() => list.data ?? [], [list.data]);

  /** Total du panier affiché — c'est lui que le pied et la pagination comptent. */
  const activeTotal = useMemo(() => {
    if (c === undefined) return 0;
    switch (bucket) {
      case 'low':       return c.low_count;
      case 'zero':      return c.zero_count;
      case 'negative':  return c.negative_count;
      case 'untracked': return c.untracked_count;
      default:          return c.total_count;
    }
  }, [c, bucket]);

  function pick(next: StockBucket): void {
    setBucket(next);
    setPage(0);
  }

  const counterItems = useMemo<ListCounter[]>(() => [
    {
      id: 'all', label: 'All products', value: c?.total_count ?? 0,
      onSelect: () => { pick('all'); },
    },
    {
      id: 'low', label: 'Low stock', value: c?.low_count ?? 0,
      tone: (c?.low_count ?? 0) > 0 ? 'warning' : 'neutral',
      title: 'Below the configured minimum. Includes products at zero or negative — this is the full reorder list, so the counters do not add up to the total.',
      onSelect: () => { pick('low'); },
    },
    {
      id: 'zero', label: 'At zero', value: c?.zero_count ?? 0,
      tone: (c?.zero_count ?? 0) > 0 ? 'danger' : 'neutral',
      title: 'Out of stock right now. A product with no minimum configured never shows under Low stock, so this is the only place it surfaces.',
      onSelect: () => { pick('zero'); },
    },
    {
      id: 'negative', label: 'Negative', value: c?.negative_count ?? 0,
      tone: (c?.negative_count ?? 0) > 0 ? 'danger' : 'neutral',
      title: 'Stock below zero — a sale was recorded before its receipt. Investigate rather than adjust blindly.',
      onSelect: () => { pick('negative'); },
    },
    {
      id: 'untracked', label: 'Not tracked', value: c?.untracked_count ?? 0,
      title: 'Products sold without stock deduction. They have no stock level and never appear in the other buckets.',
      onSelect: () => { pick('untracked'); },
    },
  ], [c]);

  const columns = useMemo<readonly DataTableColumn<Row>[]>(() => [
    {
      id: 'sku', header: 'SKU', width: '7rem',
      render: (r) => <span className="font-data text-xs text-text-secondary">{r.sku}</span>,
    },
    {
      id: 'name', header: 'Product',
      // Un vrai lien, et non un `<td role="button">` : celui-ci écrasait la
      // sémantique de cellule (chaque ligne annonçait une colonne de moins) et
      // interdisait l'ouverture dans un nouvel onglet.
      render: (r) => (
        <span className="flex items-center">
          <a
            href={`/backoffice/inventory/${r.product_id}`}
            onClick={(e) => { e.preventDefault(); void navigate(`/backoffice/inventory/${r.product_id}`); }}
            className="text-gold hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
          >
            {r.name}
          </a>
          {r.track_inventory && (
            <LowStockBadge currentStock={r.current_stock} minStockThreshold={r.min_stock_threshold} />
          )}
        </span>
      ),
    },
    {
      id: 'category', header: 'Category', width: '9rem',
      render: (r) => <span className="text-text-secondary">{r.category_name ?? '—'}</span>,
    },
    {
      id: 'onhand', header: 'On hand', align: 'right', width: '9rem',
      render: (r) => (
        r.track_inventory
          ? (
            <span className="font-data tabular-nums">
              {r.current_stock.toLocaleString()}
              <span className="ml-1 text-text-muted">{r.unit}</span>
            </span>
          )
          : <span className="text-text-muted">Not tracked</span>
      ),
    },
    {
      id: 'value', header: 'Value at cost', align: 'right', width: '10rem',
      render: (r) => (
        r.track_inventory
          ? <span className="font-data tabular-nums">{formatIdr(r.stock_value)}</span>
          : <span className="text-text-muted">—</span>
      ),
    },
    {
      id: 'moved', header: 'Last movement', width: '9rem',
      render: (r) => <span className="text-text-secondary">{formatLastMovement(r.last_movement_at)}</span>,
    },
    {
      id: 'actions', header: <span className="sr-only">Row actions</span>, align: 'right', width: '4rem',
      render: (r) => (
        <StockRowActions
          row={r}
          canAdjust={canAdjust}
          canWaste={canWaste}
          onView={(x) => { void navigate(`/backoffice/inventory/${x.product_id}`); }}
          onAdjust={(x) => setModal({ kind: 'adjust', product: x })}
          onWaste={(x) => setModal({ kind: 'waste', product: x })}
        />
      ),
    },
  ], [canAdjust, canWaste, navigate]);

  if (!canRead) {
    return (
      <div className="flex flex-col gap-[13px]">
        <PageHeader title="Stock &amp; Inventory" />
        <p role="status" className="rounded-md border border-border-subtle bg-bg-elevated p-4 text-sm text-text-secondary">
          You do not have permission to view inventory. Ask an administrator for the
          <span className="font-data"> inventory.read </span> permission.
        </p>
      </div>
    );
  }

  const hasMore = (page + 1) * PAGE_SIZE < activeTotal;
  const hasPrev = page > 0;

  function resetPage(): void { setPage(0); }
  function closeModal(): void { setModal({ kind: 'none' }); }

  return (
    <div className="flex flex-col gap-[13px]">
      <PageHeader
        title="Stock &amp; Inventory"
        subtitle="Every product that carries a stock level, worst first. Corrections are recorded as new movements — nothing here is edited in place."
        actions={
          <>
            {canAdjust && (
              <button type="button" className={TOOLBAR_BTN_SECONDARY} onClick={() => setModal({ kind: 'adjust' })}>
                <Plus className="h-3.5 w-3.5" aria-hidden /> Adjust
              </button>
            )}
            {canWaste && (
              <button type="button" className={`${TOOLBAR_BTN_SECONDARY} text-red-as-text`} onClick={() => setModal({ kind: 'waste' })}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden /> Waste
              </button>
            )}
            {canReceive && (
              <button
                type="button"
                className={TOOLBAR_BTN_PRIMARY}
                onClick={() => { void navigate('/backoffice/inventory/incoming'); }}
              >
                <Truck className="h-3.5 w-3.5" aria-hidden /> Receive
              </button>
            )}
          </>
        }
      />

      <ListCounterStrip
        counters={counterItems}
        activeId={bucket}
        ariaLabel="Stock filters"
        data-testid="stock-counters"
      />

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="inv-search" className="sr-only">Search</label>
        <Input
          id="inv-search"
          value={search}
          onChange={(e) => { setSearch(e.target.value); resetPage(); }}
          placeholder="Search by SKU or product name"
          maxLength={64}
          className="w-full max-w-xs"
        />
        <label htmlFor="inv-category" className="sr-only">Category</label>
        <Select
          id="inv-category"
          value={categoryId}
          onChange={(e) => { setCategoryId(e.target.value); resetPage(); }}
          disabled={refData.isLoading}
          className="w-48"
        >
          <option value="">All categories</option>
          {refData.data?.categories.map((cat) => (
            <option key={cat.id} value={cat.id}>{cat.name}</option>
          ))}
        </Select>
      </div>

      {/* Sans annonce, cocher un compteur fait passer la table de 318 à 14
          lignes en silence pour un lecteur d'écran. */}
      <span className="sr-only" role="status" aria-live="polite">
        {counters.isLoading ? 'Loading stock counts' : `${activeTotal} products in the current filter`}
      </span>

      {list.error !== null ? (
        <p role="alert" className="rounded-md border border-red bg-red-soft p-4 text-sm text-red-as-text">
          Stock levels could not be loaded. The list may be out of date.{' '}
          <button type="button" className="underline" onClick={() => { void list.refetch(); }}>
            Try again
          </button>
        </p>
      ) : (
        <DataTable<Row>
          columns={columns}
          rows={pageRows}
          getRowKey={(r) => r.product_id}
          isLoading={list.isLoading}
          density="compact"
          emptyTitle="No product here"
          emptyDescription={
            search !== '' || categoryId !== '' || bucket !== 'all'
              ? 'Nothing matches this filter. Widen the search, or pick another counter above.'
              : 'No product carries a stock level yet.'
          }
          data-testid="stock-levels-table"
          footer={
            <div className="flex items-center justify-between">
              <span className="font-data text-[11px] tabular-nums text-text-muted">
                {pageRows.length} of {activeTotal.toLocaleString()}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={TOOLBAR_BTN_SECONDARY}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={!hasPrev}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className={TOOLBAR_BTN_SECONDARY}
                  onClick={() => setPage((p) => p + 1)}
                  disabled={!hasMore}
                >
                  Next
                </button>
              </div>
            </div>
          }
        />
      )}

      <AdjustModal
        open={modal.kind === 'adjust'}
        {...(modal.kind === 'adjust' && modal.product !== undefined ? { initialProduct: modal.product } : {})}
        onClose={closeModal}
      />
      <WasteModal
        open={modal.kind === 'waste'}
        {...(modal.kind === 'waste' && modal.product !== undefined ? { initialProduct: modal.product } : {})}
        onClose={closeModal}
      />
    </div>
  );
}
