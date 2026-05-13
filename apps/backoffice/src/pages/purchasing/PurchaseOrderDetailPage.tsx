// apps/backoffice/src/pages/purchasing/PurchaseOrderDetailPage.tsx
//
// Session 13 — Phase 3.A — Detail view: header, lines, GRN history,
// Receive + Cancel actions, Print button.

import { useState, type JSX } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Printer, Truck, XCircle } from 'lucide-react';
import { Button } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { usePurchaseOrderDetail } from '@/features/purchasing/hooks/usePurchaseOrderDetail.js';
import { useReceivePurchaseOrder } from '@/features/purchasing/hooks/useReceivePurchaseOrder.js';
import { useCancelPurchaseOrder } from '@/features/purchasing/hooks/useCancelPurchaseOrder.js';
import { POStatusBadge } from '@/features/purchasing/components/POStatusBadge.js';
import { ReceiveDialog } from '@/features/purchasing/components/ReceiveDialog.js';
import { CancelDialog } from '@/features/purchasing/components/CancelDialog.js';
import { POPrintView } from '@/features/purchasing/components/POPrintView.js';
import { useSections } from '@/features/inventory-transfers/hooks/useSections.js';
import type { POStatus } from '@/features/purchasing/hooks/usePurchaseOrdersList.js';

function fmt(amount: number | string | null): string {
  return Number(amount ?? 0).toLocaleString('id-ID', { maximumFractionDigits: 2 });
}

export default function PurchaseOrderDetailPage(): JSX.Element {
  const navigate      = useNavigate();
  const { id }        = useParams<{ id: string }>();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead       = hasPermission('purchasing.po.read' as never);
  const canReceive    = hasPermission('purchasing.po.receive' as never);
  const canCancel     = hasPermission('purchasing.po.cancel' as never);

  const detail        = usePurchaseOrderDetail(id);
  const sections      = useSections();
  const receive       = useReceivePurchaseOrder();
  const cancel        = useCancelPurchaseOrder();

  const [showReceive, setShowReceive] = useState(false);
  const [showCancel,  setShowCancel]  = useState(false);
  const [showPrint,   setShowPrint]   = useState(false);
  const [receiveError, setReceiveError] = useState<string | undefined>(undefined);
  const [cancelError,  setCancelError]  = useState<string | undefined>(undefined);

  if (!canRead) {
    return <div className="text-text-secondary">You do not have permission to view this purchase order.</div>;
  }
  if (detail.isLoading) return <div className="text-text-secondary">Loading…</div>;
  if (detail.isError)    return <div className="text-danger">Failed to load purchase order.</div>;
  const po = detail.data;
  if (po === null || po === undefined) return <div className="text-text-secondary">Purchase order not found.</div>;

  const status   = po.status as POStatus;
  const canRcv   = canReceive && (status === 'pending' || status === 'partial');
  const canCncl  = canCancel  && status === 'pending'
                              && (po.goods_receipt_notes?.length ?? 0) === 0;

  async function handleReceive(args: {
    sectionId: string;
    items: { poItemId: string; receivedQuantity: number }[];
  }): Promise<void> {
    setReceiveError(undefined);
    try {
      await receive.mutateAsync({
        poId:       po!.id,
        sectionId:  args.sectionId,
        items:      args.items,
      });
      setShowReceive(false);
    } catch (e) {
      setReceiveError(e instanceof Error ? e.message : 'Unknown error');
    }
  }

  async function handleCancel(reason: string): Promise<void> {
    setCancelError(undefined);
    try {
      await cancel.mutateAsync({ poId: po!.id, reason });
      setShowCancel(false);
    } catch (e) {
      setCancelError(e instanceof Error ? e.message : 'Unknown error');
    }
  }

  if (showPrint) {
    return (
      <div className="space-y-3">
        <div className="flex gap-2 print:hidden">
          <Button type="button" variant="ghost" onClick={() => setShowPrint(false)}>
            <ArrowLeft className="h-4 w-4" aria-hidden /> Back
          </Button>
          <Button type="button" variant="primary" onClick={() => window.print()}>
            <Printer className="h-4 w-4" aria-hidden /> Print
          </Button>
        </div>
        <POPrintView po={po} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Button type="button" variant="ghost" size="sm" onClick={() => navigate('/backoffice/purchasing/purchase-orders')}>
            <ArrowLeft className="h-4 w-4" aria-hidden /> Back
          </Button>
          <h1 className="font-serif text-3xl mt-2">{po.po_number}</h1>
          <div className="flex items-center gap-3 mt-1">
            <POStatusBadge status={status} />
            <span className="text-text-secondary text-sm">{po.suppliers?.name ?? '—'}</span>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button type="button" variant="ghost" onClick={() => setShowPrint(true)}>
            <Printer className="h-4 w-4" aria-hidden /> Print
          </Button>
          {canRcv && (
            <Button type="button" variant="primary" onClick={() => setShowReceive(true)}>
              <Truck className="h-4 w-4" aria-hidden /> Receive
            </Button>
          )}
          {canCncl && (
            <Button type="button" variant="ghostDestructive" onClick={() => setShowCancel(true)}>
              <XCircle className="h-4 w-4" aria-hidden /> Cancel
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
        <Stat label="Subtotal"     value={fmt(po.subtotal)} />
        <Stat label="VAT"          value={fmt(po.vat_amount)} />
        <Stat label="Total"        value={fmt(po.total_amount)} emphasis />
        <Stat label="Order date"   value={po.order_date ?? '—'} />
        <Stat label="Expected"     value={po.expected_date ?? '—'} />
        <Stat label="Received"     value={po.received_date ?? '—'} />
        <Stat label="Payment terms" value={po.payment_terms === 'cash' ? 'Cash' : 'Credit'} />
        {po.cancel_reason !== null && (
          <Stat label="Cancel reason" value={po.cancel_reason} />
        )}
      </div>

      <section className="space-y-2">
        <h2 className="font-serif text-xl">Line items</h2>
        <div className="overflow-x-auto border border-border-subtle rounded-md">
          <table className="w-full text-sm">
            <thead className="bg-bg-overlay text-text-secondary text-xs uppercase tracking-widest">
              <tr>
                <th className="text-left px-3 py-2">Product</th>
                <th className="text-right px-3 py-2 w-24">Ordered</th>
                <th className="text-right px-3 py-2 w-24">Received</th>
                <th className="text-left px-3 py-2 w-20">Unit</th>
                <th className="text-right px-3 py-2 w-24">Unit cost</th>
                <th className="text-right px-3 py-2 w-32">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {po.purchase_order_items.map((it) => (
                <tr key={it.id} className="border-t border-border-subtle">
                  <td className="px-3 py-2">
                    {it.products?.name ?? '?'}{' '}
                    <span className="text-text-secondary text-xs">({it.products?.sku ?? '—'})</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(it.quantity)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(it.received_quantity)}</td>
                  <td className="px-3 py-2">{it.unit}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(it.unit_cost)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(it.subtotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="font-serif text-xl">Goods receipt notes</h2>
        {po.goods_receipt_notes.length === 0 ? (
          <p className="text-text-secondary text-sm">No receipts recorded yet.</p>
        ) : (
          <div className="overflow-x-auto border border-border-subtle rounded-md">
            <table className="w-full text-sm">
              <thead className="bg-bg-overlay text-text-secondary text-xs uppercase tracking-widest">
                <tr>
                  <th className="text-left px-3 py-2">GRN</th>
                  <th className="text-left px-3 py-2 w-32">Date</th>
                  <th className="text-right px-3 py-2 w-32">Subtotal</th>
                  <th className="text-right px-3 py-2 w-32">VAT</th>
                  <th className="text-right px-3 py-2 w-32">Total</th>
                </tr>
              </thead>
              <tbody>
                {po.goods_receipt_notes.map((g) => (
                  <tr key={g.id} className="border-t border-border-subtle">
                    <td className="px-3 py-2 font-mono text-xs">{g.grn_number}</td>
                    <td className="px-3 py-2">{g.received_date}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(g.subtotal)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(g.vat_amount)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(g.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {po.notes !== null && po.notes !== '' && (
        <section className="space-y-1">
          <h2 className="font-serif text-xl">Notes</h2>
          <p className="text-sm text-text-secondary">{po.notes}</p>
        </section>
      )}

      {showReceive && (
        <ReceiveDialog
          po={po}
          sections={(sections.data ?? []).map((s) => ({ id: s.id, code: s.code, name: s.name }))}
          onCancel={() => setShowReceive(false)}
          onConfirm={handleReceive}
          submitting={receive.isPending}
          {...(receiveError !== undefined ? { error: receiveError } : {})}
        />
      )}
      {showCancel && (
        <CancelDialog
          poNumber={po.po_number}
          onCancel={() => setShowCancel(false)}
          onConfirm={handleCancel}
          submitting={cancel.isPending}
          {...(cancelError !== undefined ? { error: cancelError } : {})}
        />
      )}
    </div>
  );
}

function Stat({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }): JSX.Element {
  return (
    <div className="rounded-md border border-border-subtle bg-bg-elevated px-3 py-2">
      <div className="text-xs uppercase tracking-widest text-text-secondary">{label}</div>
      <div className={`mt-0.5 ${emphasis ? 'text-lg font-semibold' : 'text-sm'} tabular-nums text-text-primary`}>
        {value}
      </div>
    </div>
  );
}
