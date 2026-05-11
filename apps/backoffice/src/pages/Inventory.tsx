// apps/backoffice/src/pages/Inventory.tsx
//
// Backoffice inventory page. Filterable stock-level list + 3 modals
// (Adjust / Receive / Waste) + movement history drawer. RLS handles real
// auth at the DB layer; the toolbar buttons are gated UX-only.
//
// Spec ref: docs/superpowers/specs/2026-05-11-session-12-inventory-mvp-spec.md §3 (Phase 4)

import { Plus, Truck, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { AdjustModal } from '@/features/inventory/components/AdjustModal.js';
import { ReceiveModal } from '@/features/inventory/components/ReceiveModal.js';
import { WasteModal } from '@/features/inventory/components/WasteModal.js';
import { MovementHistoryDrawer } from '@/features/inventory/components/MovementHistoryDrawer.js';
import { StockLevelRow } from '@/features/inventory/components/StockLevelRow.js';
import {
  useStockLevels,
  type StockLevelRow as Row,
  type StockLevelsFilters,
} from '@/features/inventory/hooks/useStockLevels.js';
import { useInventoryReferenceData } from '@/features/inventory/hooks/useInventoryReferenceData.js';

const PAGE_SIZE = 50;

type ModalState =
  | { kind: 'none' }
  | { kind: 'adjust';  product?: Row }
  | { kind: 'receive'; product?: Row }
  | { kind: 'waste';   product?: Row }
  | { kind: 'history'; product: Row };

export default function InventoryPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead    = hasPermission('inventory.read');
  const canAdjust  = hasPermission('inventory.adjust');
  const canReceive = hasPermission('inventory.receive');
  const canWaste   = hasPermission('inventory.waste');

  const [search,        setSearch       ] = useState<string>('');
  const [categoryId,    setCategoryId   ] = useState<string>('');
  const [lowStockOnly,  setLowStockOnly ] = useState<boolean>(false);
  const [page,          setPage         ] = useState<number>(0);
  const [modal,         setModal        ] = useState<ModalState>({ kind: 'none' });

  const filters = useMemo<StockLevelsFilters>(
    () => ({
      ...(search       !== ''   ? { search }     : {}),
      ...(categoryId   !== ''   ? { categoryId } : {}),
      ...(lowStockOnly === true ? { lowStockOnly: true } : {}),
      limit:  PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [search, categoryId, lowStockOnly, page],
  );

  const list    = useStockLevels(filters);
  const refData = useInventoryReferenceData();

  if (!canRead) {
    return <div className="text-text-secondary">You do not have permission to view inventory.</div>;
  }

  const totalCount = list.data?.[0]?.total_count ?? 0;
  const hasMore   = (page + 1) * PAGE_SIZE < totalCount;
  const hasPrev   = page > 0;

  function resetPage(): void { setPage(0); }
  function closeModal(): void { setModal({ kind: 'none' }); }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-serif text-3xl">Inventory</h1>
          <p className="text-text-secondary text-sm mt-1">
            Stock levels, movements, and corrections.
          </p>
        </div>
        <div className="flex gap-2">
          {canAdjust && (
            <Button type="button" variant="secondary" onClick={() => setModal({ kind: 'adjust' })}>
              <Plus className="h-4 w-4" aria-hidden /> Adjust
            </Button>
          )}
          {canReceive && (
            <Button type="button" variant="primary" onClick={() => setModal({ kind: 'receive' })}>
              <Truck className="h-4 w-4" aria-hidden /> Receive
            </Button>
          )}
          {canWaste && (
            <Button type="button" variant="ghostDestructive" onClick={() => setModal({ kind: 'waste' })}>
              <Trash2 className="h-4 w-4" aria-hidden /> Waste
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end bg-bg-elevated border border-border-subtle rounded-lg p-4">
        <div className="space-y-1 flex-1 min-w-[12rem]">
          <label htmlFor="inv-search" className="text-xs uppercase tracking-widest text-text-secondary">Search</label>
          <input
            id="inv-search"
            value={search}
            onChange={(e) => { setSearch(e.target.value); resetPage(); }}
            placeholder="SKU or product name"
            maxLength={64}
            className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="inv-category" className="text-xs uppercase tracking-widest text-text-secondary">Category</label>
          <select
            id="inv-category"
            value={categoryId}
            onChange={(e) => { setCategoryId(e.target.value); resetPage(); }}
            className="h-9 rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary min-w-[10rem]"
            disabled={refData.isLoading}
          >
            <option value="">All categories</option>
            {refData.data?.categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <span className="text-xs uppercase tracking-widest text-text-secondary block">Status</span>
          <label className="flex items-center gap-2 h-9 text-sm text-text-primary">
            <input
              type="checkbox"
              checked={lowStockOnly}
              onChange={(e) => { setLowStockOnly(e.target.checked); resetPage(); }}
            />
            Low stock only
          </label>
        </div>
      </div>

      {/* Table */}
      {list.isLoading && <div className="text-text-secondary py-12 text-center">Loading…</div>}
      {list.error && <div className="text-red py-12 text-center">Failed to load: {list.error.message}</div>}
      {list.data?.length === 0 && (
        <div className="text-text-secondary py-12 text-center">
          {search !== '' || categoryId !== '' || lowStockOnly
            ? 'No products match the current filters.'
            : 'No products with stock activity.'}
        </div>
      )}
      {list.data !== undefined && list.data.length > 0 && (
        <div className="bg-bg-elevated rounded-lg border border-border-subtle overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-text-secondary">
              <tr>
                <th className="text-left px-3 py-2 w-24">SKU</th>
                <th className="text-left px-3 py-2">Name</th>
                <th className="text-left px-3 py-2 w-32">Category</th>
                <th className="text-right px-3 py-2 w-24">On hand</th>
                <th className="text-left px-3 py-2 w-32">Last movement</th>
                <th className="text-right px-3 py-2 w-16" />
              </tr>
            </thead>
            <tbody>
              {list.data.map((row) => (
                <StockLevelRow
                  key={row.product_id}
                  row={row}
                  canAdjust={canAdjust}
                  canReceive={canReceive}
                  canWaste={canWaste}
                  onView={(r) => setModal({ kind: 'history', product: r })}
                  onAdjust={(r) => setModal({ kind: 'adjust', product: r })}
                  onReceive={(r) => setModal({ kind: 'receive', product: r })}
                  onWaste={(r) => setModal({ kind: 'waste', product: r })}
                />
              ))}
            </tbody>
          </table>

          <div className="flex items-center justify-between px-3 py-2 text-xs border-t border-border-subtle">
            <span className="text-text-secondary">
              Page {page + 1} · {totalCount.toLocaleString()} total
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={!hasPrev}
              >
                Previous
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPage((p) => p + 1)}
                disabled={!hasMore}
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      <AdjustModal
        open={modal.kind === 'adjust'}
        {...(modal.kind === 'adjust' && modal.product !== undefined ? { initialProduct: modal.product } : {})}
        onClose={closeModal}
      />
      <ReceiveModal
        open={modal.kind === 'receive'}
        {...(modal.kind === 'receive' && modal.product !== undefined ? { initialProduct: modal.product } : {})}
        onClose={closeModal}
      />
      <WasteModal
        open={modal.kind === 'waste'}
        {...(modal.kind === 'waste' && modal.product !== undefined ? { initialProduct: modal.product } : {})}
        onClose={closeModal}
      />
      <MovementHistoryDrawer
        product={modal.kind === 'history' ? modal.product : undefined}
        onClose={closeModal}
      />
    </div>
  );
}
