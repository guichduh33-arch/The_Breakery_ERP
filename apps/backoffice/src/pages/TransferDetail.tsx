// apps/backoffice/src/pages/TransferDetail.tsx
//
// Session 14 / Phase 6.A — single-transfer view. Shows the header (number,
// status, route, dates), an items table, and contextual action buttons
// (Receive / Cancel) gated by status + permission. Metadata grid uses the
// SectionLabel primitive for the dt's so the typography matches the rest
// of the inventory family.
//
// Spec ref: docs/reference/04-modules/06-inventory-stock.md §III (Phase 3 UI)

import { useMemo, useState, type JSX } from 'react';
import { ChevronLeft } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { useTransferDetail } from '@/features/inventory-transfers/hooks/useTransferDetail.js';
import { TransferStatusBadge } from '@/features/inventory-transfers/components/TransferStatusBadge.js';
import { TransferReceiveModal } from '@/features/inventory-transfers/components/TransferReceiveModal.js';
import { TransferCancelConfirm } from '@/features/inventory-transfers/components/TransferCancelConfirm.js';

type ModalKind = 'none' | 'receive' | 'cancel';

export default function TransferDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canReceive    = hasPermission('inventory.transfer.receive');
  const canCancel     = hasPermission('inventory.transfer.create');

  const detail = useTransferDetail(id);
  const [modal, setModal] = useState<ModalKind>('none');

  const receiveModalItems = useMemo(() => {
    if (detail.data === undefined) return [];
    return detail.data.items.map((it) => ({
      id:                 it.id,
      product_name:       it.product_name,
      quantity_requested: it.quantity_requested,
      unit:               it.unit,
    }));
  }, [detail.data]);

  if (id === undefined || id === '') {
    return <div className="text-text-secondary">Missing transfer id.</div>;
  }

  if (detail.isLoading) {
    return <div className="text-text-secondary py-12 text-center">Loading…</div>;
  }
  if (detail.error) {
    return (
      <div className="text-red py-12 text-center">
        Failed to load transfer: {detail.error.message}
      </div>
    );
  }
  if (detail.data === undefined) {
    return <div className="text-text-secondary">Transfer not found.</div>;
  }

  const { transfer, items } = detail.data;
  const canReceiveNow = canReceive && (transfer.status === 'pending' || transfer.status === 'in_transit');
  const canCancelNow  = canCancel && (transfer.status === 'draft'   || transfer.status === 'pending');

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/backoffice/inventory/transfers"
          className="inline-flex items-center gap-1 text-text-secondary text-xs hover:text-text-primary"
        >
          <ChevronLeft className="h-3 w-3" aria-hidden /> Back to transfers
        </Link>
        <div className="flex items-center gap-3 mt-2">
          <h1 className="font-serif text-3xl font-mono">{transfer.transfer_number}</h1>
          <TransferStatusBadge status={transfer.status} />
        </div>
      </div>

      {/* Metadata grid */}
      <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-bg-elevated border border-border-subtle rounded-lg p-4">
        <div className="space-y-1">
          <dt className="text-xs font-bold uppercase tracking-widest text-text-muted">From</dt>
          <dd className="text-sm">{transfer.sections?.name ?? '—'}</dd>
        </div>
        <div className="space-y-1">
          <dt className="text-xs font-bold uppercase tracking-widest text-text-muted">To</dt>
          <dd className="text-sm">{transfer.to_section?.name ?? '—'}</dd>
        </div>
        <div className="space-y-1">
          <dt className="text-xs font-bold uppercase tracking-widest text-text-muted">Created</dt>
          <dd className="text-sm font-mono">{new Date(transfer.created_at).toLocaleString()}</dd>
        </div>
        <div className="space-y-1">
          <dt className="text-xs font-bold uppercase tracking-widest text-text-muted">Received</dt>
          <dd className="text-sm font-mono">
            {transfer.received_at !== null
              ? new Date(transfer.received_at).toLocaleString()
              : '—'}
          </dd>
        </div>
        {transfer.notes !== null && transfer.notes !== '' && (
          <div className="col-span-2 md:col-span-4 space-y-1">
            <dt className="text-xs font-bold uppercase tracking-widest text-text-muted">Notes</dt>
            <dd className="text-sm">{transfer.notes}</dd>
          </div>
        )}
      </dl>

      {/* Action buttons */}
      {(canReceiveNow || canCancelNow) && (
        <div className="flex gap-2">
          {canReceiveNow && (
            <Button type="button" variant="primary" onClick={() => setModal('receive')}>
              Receive transfer
            </Button>
          )}
          {canCancelNow && (
            <Button type="button" variant="ghostDestructive" onClick={() => setModal('cancel')}>
              Cancel transfer
            </Button>
          )}
        </div>
      )}

      {/* Items table */}
      <div className="bg-bg-elevated rounded-lg border border-border-subtle overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-text-secondary">
            <tr>
              <th className="text-left px-3 py-2 w-28">SKU</th>
              <th className="text-left px-3 py-2">Product</th>
              <th className="text-right px-3 py-2 w-28">Requested</th>
              <th className="text-right px-3 py-2 w-28">Received</th>
              <th className="text-left px-3 py-2 w-20">Unit</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="border-t border-border-subtle">
                <td className="px-3 py-2 font-mono text-xs">{it.product_sku}</td>
                <td className="px-3 py-2">{it.product_name}</td>
                <td className="px-3 py-2 text-right font-mono">{it.quantity_requested}</td>
                <td className="px-3 py-2 text-right font-mono">
                  {it.quantity_received ?? '—'}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-text-secondary">{it.unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <TransferReceiveModal
        open={modal === 'receive'}
        onClose={() => setModal('none')}
        transferId={transfer.id}
        items={receiveModalItems}
      />
      <TransferCancelConfirm
        open={modal === 'cancel'}
        onClose={() => setModal('none')}
        transferId={transfer.id}
        transferNumber={transfer.transfer_number}
      />
    </div>
  );
}
