// apps/backoffice/src/pages/purchasing/PurchaseOrdersListPage.tsx
//
// Session 13 — Phase 3.A — Filterable list of purchase orders.

import { useMemo, useState, type JSX } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import {
  usePurchaseOrdersList,
  type POStatus,
  type PurchaseOrdersFilters,
} from '@/features/purchasing/hooks/usePurchaseOrdersList.js';
import { POStatusBadge } from '@/features/purchasing/components/POStatusBadge.js';
import { useSuppliersList } from '@/features/suppliers/hooks/useSuppliersList.js';

const STATUSES: { value: POStatus | 'all'; label: string }[] = [
  { value: 'all',       label: 'All' },
  { value: 'pending',   label: 'Pending' },
  { value: 'partial',   label: 'Partial' },
  { value: 'received',  label: 'Received' },
  { value: 'cancelled', label: 'Cancelled' },
];

function fmt(amount: number | string | null): string {
  return Number(amount ?? 0).toLocaleString('id-ID', { maximumFractionDigits: 2 });
}

export default function PurchaseOrdersListPage(): JSX.Element {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead   = hasPermission('purchasing.po.read' as never);
  const canCreate = hasPermission('purchasing.po.create' as never);

  const [status, setStatus]         = useState<POStatus | 'all'>('all');
  const [supplierId, setSupplierId] = useState<string>('');
  const [search, setSearch]         = useState<string>('');

  const filters = useMemo<PurchaseOrdersFilters>(() => ({
    ...(status !== 'all' ? { status } : {}),
    ...(supplierId !== '' ? { supplierId } : {}),
    ...(search.trim() !== '' ? { search } : {}),
  }), [status, supplierId, search]);

  const list      = usePurchaseOrdersList(filters);
  const suppliers = useSuppliersList({ active: 'active' });

  if (!canRead) {
    return <div className="text-text-secondary">You do not have permission to view purchase orders.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-serif text-3xl">Purchase Orders</h1>
          <p className="text-text-secondary text-sm mt-1">
            Track open and historical POs; receive goods to post inventory & accounting entries.
          </p>
        </div>
        {canCreate && (
          <Link to="/backoffice/purchasing/purchase-orders/new">
            <Button type="button" variant="primary">
              <Plus className="h-4 w-4" aria-hidden /> New PO
            </Button>
          </Link>
        )}
      </div>

      <div className="flex flex-wrap gap-3 items-end bg-bg-elevated border border-border-subtle rounded-lg p-4">
        <div className="space-y-1 flex-1 min-w-[12rem]">
          <label htmlFor="po-search" className="text-xs uppercase tracking-widest text-text-secondary">
            Search PO number
          </label>
          <input
            id="po-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="PO-2026…"
            maxLength={64}
            className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="po-status" className="text-xs uppercase tracking-widest text-text-secondary">Status</label>
          <select
            id="po-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as POStatus | 'all')}
            className="h-9 rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary"
          >
            {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="po-supplier" className="text-xs uppercase tracking-widest text-text-secondary">Supplier</label>
          <select
            id="po-supplier"
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className="h-9 rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary"
          >
            <option value="">All</option>
            {(suppliers.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
            ))}
          </select>
        </div>
      </div>

      <div className="overflow-x-auto border border-border-subtle rounded-md bg-bg-elevated">
        <table className="w-full text-sm">
          <thead className="bg-bg-overlay text-text-secondary text-xs uppercase tracking-widest">
            <tr>
              <th className="text-left px-4 py-2">PO Number</th>
              <th className="text-left px-4 py-2">Supplier</th>
              <th className="text-left px-4 py-2 w-24">Status</th>
              <th className="text-left px-4 py-2 w-28">Order date</th>
              <th className="text-left px-4 py-2 w-28">Expected</th>
              <th className="text-right px-4 py-2 w-32">Total</th>
            </tr>
          </thead>
          <tbody>
            {list.isLoading && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-text-secondary">Loading…</td></tr>
            )}
            {list.isError && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-danger">Failed to load purchase orders.</td></tr>
            )}
            {!list.isLoading && (list.data ?? []).length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-text-secondary">No purchase orders found.</td></tr>
            )}
            {(list.data ?? []).map((po) => (
              <tr key={po.id} className="border-t border-border-subtle hover:bg-bg-overlay/40">
                <td className="px-4 py-2">
                  <Link to={`/backoffice/purchasing/purchase-orders/${po.id}`} className="text-gold hover:underline">
                    {po.po_number}
                  </Link>
                </td>
                <td className="px-4 py-2">{po.suppliers?.name ?? '—'}</td>
                <td className="px-4 py-2"><POStatusBadge status={po.status as POStatus} /></td>
                <td className="px-4 py-2 tabular-nums">{po.order_date ?? '—'}</td>
                <td className="px-4 py-2 tabular-nums">{po.expected_date ?? '—'}</td>
                <td className="px-4 py-2 text-right tabular-nums">{fmt(po.total_amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
