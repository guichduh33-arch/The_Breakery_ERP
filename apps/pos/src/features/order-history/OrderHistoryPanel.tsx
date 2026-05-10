// apps/pos/src/features/order-history/OrderHistoryPanel.tsx
//
// Session 10 — full-screen panel listing the current shift's paid orders.
// Tap an order → drawer with details + Void / Refund buttons.

import { useState, type JSX } from 'react';
import { X } from 'lucide-react';
import { Button, Currency, FullScreenModal, cn } from '@breakery/ui';
import { RefundReceiptModal } from '@breakery/ui';
import { useOrderHistory } from './hooks/useOrderHistory';
import { useOrderDetail } from './hooks/useOrderDetail';
import { useVoidOrder, type VoidResponse } from './hooks/useVoidOrder';
import { useRefundOrder, type RefundResponse } from './hooks/useRefundOrder';
import { OrderDetailDrawer } from './components/OrderDetailDrawer';
import { VoidOrderModal } from './components/VoidOrderModal';
import { RefundOrderModal } from './components/RefundOrderModal';
import { toast } from 'sonner';
import type { TenderRowMethod } from '@breakery/ui';

interface OrderHistoryPanelProps {
  open: boolean;
  onClose: () => void;
}

export function OrderHistoryPanel({ open, onClose }: OrderHistoryPanelProps): JSX.Element {
  const history = useOrderHistory();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const detail = useOrderDetail(selectedId);

  const [voidOpen, setVoidOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [receipt, setReceipt] = useState<{
    refundNumber: string;
    orderNumber: string;
    totalRefunded: number;
    tenders: { method: TenderRowMethod; amount: number }[];
    isFullVoid: boolean;
  } | null>(null);

  const voidMutation = useVoidOrder();
  const refundMutation = useRefundOrder();

  function presentReceipt(res: VoidResponse | RefundResponse, isFullVoid: boolean): void {
    setReceipt({
      refundNumber: res.refund_number,
      orderNumber: res.order_number,
      totalRefunded: res.total_refunded,
      tenders: res.tenders.map((t) => ({ method: t.method, amount: t.amount })),
      isFullVoid,
    });
  }

  function handleClose(): void {
    setSelectedId(null);
    setVoidOpen(false);
    setRefundOpen(false);
    setReceipt(null);
    onClose();
  }

  return (
    <>
      <FullScreenModal open={open && !receipt} onOpenChange={(o) => { if (!o) handleClose(); }}>
        <div className="flex flex-col h-screen bg-bg-base" role="dialog" aria-label="Order history">
          <header className="h-14 flex items-center justify-between px-6 border-b border-border-subtle bg-bg-elevated">
            <div className="flex items-baseline gap-3">
              <span className="font-serif text-lg">Order History</span>
              <span className="text-text-secondary text-xs uppercase tracking-widest">Current Shift</span>
            </div>
            <Button variant="ghost" size="icon" aria-label="Close" onClick={handleClose}>
              <X className="h-5 w-5" aria-hidden />
            </Button>
          </header>

          <div className="flex-1 grid grid-cols-[1fr_400px] overflow-hidden">
            <section className="overflow-y-auto p-4">
              {history.isLoading && <div className="text-text-secondary text-sm">Loading…</div>}
              {history.isError && <div className="text-red-400 text-sm">Failed to load order history</div>}
              {history.data?.length === 0 && (
                <div className="text-text-secondary text-sm py-12 text-center">
                  No orders in this shift yet.
                </div>
              )}
              <ul className="space-y-2">
                {history.data?.map((row) => {
                  const isSelected = selectedId === row.id;
                  const isVoided = row.status === 'voided';
                  const partial = row.total_refunded > 0 && !isVoided;
                  return (
                    <li key={row.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(row.id)}
                        className={cn(
                          'w-full text-left rounded-md border px-4 py-3 flex items-center justify-between transition-colors',
                          isSelected
                            ? 'border-gold bg-gold-soft'
                            : 'border-border-subtle bg-bg-elevated hover:bg-bg-overlay',
                        )}
                      >
                        <div>
                          <div className="font-mono text-base font-bold text-text-primary">
                            {row.order_number}
                            {isVoided && <span className="ml-2 text-xs text-red-400 uppercase">VOIDED</span>}
                            {partial && <span className="ml-2 text-xs text-amber-warn uppercase">PARTIAL REFUND</span>}
                          </div>
                          <div className="text-xs text-text-secondary">
                            {row.paid_at ? new Date(row.paid_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '—'}
                            {row.table_number && ` · Table ${row.table_number}`}
                          </div>
                        </div>
                        <div className="text-right">
                          <Currency amount={row.total} emphasis="gold" />
                          {row.total_refunded > 0 && (
                            <div className="text-xs text-red-400 font-mono">
                              -<Currency amount={row.total_refunded} className="text-red-400" />
                            </div>
                          )}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>

            <aside className="overflow-hidden">
              {selectedId && detail.data ? (
                <OrderDetailDrawer
                  order={detail.data}
                  onVoidClick={() => setVoidOpen(true)}
                  onRefundClick={() => setRefundOpen(true)}
                />
              ) : (
                <div className="h-full grid place-items-center text-text-muted text-sm">
                  Select an order
                </div>
              )}
            </aside>
          </div>
        </div>
      </FullScreenModal>

      {detail.data && (
        <VoidOrderModal
          open={voidOpen}
          onClose={() => setVoidOpen(false)}
          orderNumber={detail.data.order_number}
          total={detail.data.total}
          isPending={voidMutation.isPending}
          onSubmit={async ({ reason, managerPin }) => {
            try {
              const res = await voidMutation.mutateAsync({
                orderId: detail.data!.id,
                reason,
                managerPin,
              });
              setVoidOpen(false);
              presentReceipt(res, true);
            } catch (err: unknown) {
              const e = err as { details?: { error?: string }; status?: number };
              const msg = e.details?.error ?? 'void_failed';
              if (e.status === 401) toast.error('Wrong manager PIN');
              else if (e.status === 422) toast.error(`Cannot void: ${msg}`);
              else toast.error(`Void failed: ${msg}`);
              throw err;
            }
          }}
        />
      )}

      {detail.data && (
        <RefundOrderModal
          open={refundOpen}
          onClose={() => setRefundOpen(false)}
          order={detail.data}
          isPending={refundMutation.isPending}
          onSubmit={async ({ lines, tenders, reason, managerPin }) => {
            try {
              const res = await refundMutation.mutateAsync({
                orderId: detail.data!.id,
                lines,
                tenders,
                reason,
                managerPin,
              });
              setRefundOpen(false);
              presentReceipt(res, false);
            } catch (err: unknown) {
              const e = err as { details?: { error?: string }; status?: number };
              const msg = e.details?.error ?? 'refund_failed';
              if (e.status === 401) toast.error('Wrong manager PIN');
              else if (e.status === 422) toast.error(`Cannot refund: ${msg}`);
              else toast.error(`Refund failed: ${msg}`);
              throw err;
            }
          }}
        />
      )}

      {receipt && (
        <RefundReceiptModal
          open
          refundNumber={receipt.refundNumber}
          orderNumber={receipt.orderNumber}
          totalRefunded={receipt.totalRefunded}
          tenders={receipt.tenders}
          isFullVoid={receipt.isFullVoid}
          onClose={() => {
            setReceipt(null);
            setSelectedId(null);
          }}
        />
      )}
    </>
  );
}
