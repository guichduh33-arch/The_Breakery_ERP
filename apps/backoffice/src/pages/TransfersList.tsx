// apps/backoffice/src/pages/TransfersList.tsx
//
// Session 12 — Phase 3 — list page for internal stock transfers between
// sections. Permission-gated upstream on `inventory.read`.
//
// Spec ref: docs/reference/04-modules/06-inventory-stock.md §III (Phase 3 UI)

import { useMemo, useState, type JSX } from 'react';
import { Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@breakery/ui';
import type { TransferStatus } from '@breakery/domain';
import { useAuthStore } from '@/stores/authStore.js';
import {
  useInternalTransfers,
  type InternalTransfersFilters,
} from '@/features/inventory-transfers/hooks/useInternalTransfers.js';
import { useSections } from '@/features/inventory-transfers/hooks/useSections.js';
import { TransferStatusBadge } from '@/features/inventory-transfers/components/TransferStatusBadge.js';

const PAGE_SIZE = 50;

const STATUS_OPTIONS: readonly { value: '' | TransferStatus; label: string }[] = [
  { value: '',            label: 'All statuses' },
  { value: 'draft',       label: 'Draft' },
  { value: 'pending',     label: 'Pending' },
  { value: 'in_transit',  label: 'In transit' },
  { value: 'received',    label: 'Received' },
  { value: 'cancelled',   label: 'Cancelled' },
];

export default function TransfersListPage(): JSX.Element {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreate     = hasPermission('inventory.transfer.create');

  const [status,        setStatus       ] = useState<'' | TransferStatus>('');
  const [fromSectionId, setFromSectionId] = useState<string>('');
  const [toSectionId,   setToSectionId  ] = useState<string>('');
  const [page,          setPage         ] = useState<number>(0);

  const filters = useMemo<InternalTransfersFilters>(
    () => ({
      ...(status        !== '' ? { status }                 : {}),
      ...(fromSectionId !== '' ? { fromSectionId }          : {}),
      ...(toSectionId   !== '' ? { toSectionId }            : {}),
      limit:  PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [status, fromSectionId, toSectionId, page],
  );

  const list     = useInternalTransfers(filters);
  const sections = useSections();

  function resetPage(): void { setPage(0); }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-serif text-3xl">Transfers</h1>
          <p className="text-text-secondary text-sm mt-1">
            Move stock between sections. Items leave the source and land at the destination on receive.
          </p>
        </div>
        {canCreate && (
          <Link
            to="/backoffice/inventory/transfers/new"
            className="inline-flex items-center gap-2 h-touch-comfy px-4 text-sm bg-green hover:bg-green-hover text-white uppercase tracking-wide rounded-md font-semibold"
          >
            <Plus className="h-4 w-4" aria-hidden /> New Transfer
          </Link>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end bg-bg-elevated border border-border-subtle rounded-lg p-4">
        <div className="space-y-1">
          <label htmlFor="tr-status" className="text-xs uppercase tracking-widest text-text-secondary">Status</label>
          <select
            id="tr-status"
            value={status}
            onChange={(e) => { setStatus(e.target.value as '' | TransferStatus); resetPage(); }}
            className="h-9 rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary min-w-[10rem]"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="tr-from" className="text-xs uppercase tracking-widest text-text-secondary">From</label>
          <select
            id="tr-from"
            value={fromSectionId}
            onChange={(e) => { setFromSectionId(e.target.value); resetPage(); }}
            className="h-9 rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary min-w-[12rem]"
            disabled={sections.isLoading}
          >
            <option value="">All sections</option>
            {sections.data?.map((s) => (
              <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="tr-to" className="text-xs uppercase tracking-widest text-text-secondary">To</label>
          <select
            id="tr-to"
            value={toSectionId}
            onChange={(e) => { setToSectionId(e.target.value); resetPage(); }}
            className="h-9 rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary min-w-[12rem]"
            disabled={sections.isLoading}
          >
            <option value="">All sections</option>
            {sections.data?.map((s) => (
              <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      {list.isLoading && <div className="text-text-secondary py-12 text-center">Loading…</div>}
      {list.error && (
        <div className="text-red py-12 text-center">
          Failed to load transfers: {list.error.message}
        </div>
      )}
      {list.data?.length === 0 && (
        <div className="text-text-secondary py-12 text-center">
          {status !== '' || fromSectionId !== '' || toSectionId !== ''
            ? 'No transfers match the current filters.'
            : 'No transfers recorded yet.'}
        </div>
      )}
      {list.data !== undefined && list.data.length > 0 && (
        <div className="bg-bg-elevated rounded-lg border border-border-subtle overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-text-secondary">
              <tr>
                <th className="text-left px-3 py-2 w-32">Transfer #</th>
                <th className="text-left px-3 py-2">From → To</th>
                <th className="text-left px-3 py-2 w-32">Status</th>
                <th className="text-left px-3 py-2 w-40">Created</th>
                <th className="text-right px-3 py-2 w-24">Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((row) => (
                <tr key={row.id} className="border-t border-border-subtle">
                  <td className="px-3 py-2 font-mono text-xs">{row.transfer_number}</td>
                  <td className="px-3 py-2">
                    <span className="font-medium">{row.sections?.name ?? '—'}</span>
                    <span className="text-text-secondary px-2">→</span>
                    <span className="font-medium">{row.to_section?.name ?? '—'}</span>
                  </td>
                  <td className="px-3 py-2">
                    <TransferStatusBadge status={row.status} />
                  </td>
                  <td className="px-3 py-2 text-text-secondary text-xs font-mono">
                    {new Date(row.created_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      to={`/backoffice/inventory/transfers/${row.id}`}
                      className="text-gold hover:underline text-xs"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex items-center justify-between px-3 py-2 text-xs border-t border-border-subtle">
            <span className="text-text-secondary">Page {page + 1}</span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
              >
                Previous
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPage((p) => p + 1)}
                disabled={list.data.length < PAGE_SIZE}
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
