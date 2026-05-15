// apps/pos/src/features/order-history/OrderHistoryPanel.tsx
//
// Session 14 — Phase 2.D — Full-screen panel listing the current shift's
// paid orders. The list now includes the KPI strip from ref 80 (Total /
// Cash / Card / Other) and each row surfaces the payment method icon.
//
// Tap an order → drawer (right pane) with details + Void / Refund buttons,
// preserving the Session 10/13 flows underneath.

import { useMemo, useState, type JSX } from 'react';
import { X, Receipt, CreditCard, Coins, QrCode } from 'lucide-react';
import { Button, Currency, FullScreenModal, SectionLabel, cn } from '@breakery/ui';
import { RefundReceiptModal } from '@breakery/ui';
import { useOrderHistory, type OrderHistoryRow } from './hooks/useOrderHistory';
import { useOrderDetail } from './hooks/useOrderDetail';
import { useVoidOrder, type VoidResponse } from './hooks/useVoidOrder';
import { useRefundOrder, type RefundResponse } from './hooks/useRefundOrder';
import { OrderDetailDrawer } from './components/OrderDetailDrawer';
import { OrderHistoryStats } from './components/OrderHistoryStats';
import { VoidOrderModal } from './components/VoidOrderModal';
import { RefundOrderModal } from './components/RefundOrderModal';
import { toast } from 'sonner';
import type { TenderRowMethod } from '@breakery/ui';

interface OrderHistoryPanelProps {
  open: boolean;
  onClose: () => void;
}

function paymentMethodTone(method: string | null): {
  icon: typeof Receipt;
  color: string;
  label: string;
} {
  switch (method) {
    case 'cash':
      return { icon: Coins, color: 'text-green', label: 'Cash' };
    case 'qris':
    case 'ewallet':
      return { icon: QrCode, color: 'text-blue-info', label: 'QRIS' };
    case 'card':
    case 'debit_card':
    case 'credit_card':
      return { icon: CreditCard, color: 'text-purple-400', label: 'Card' };
    default:
      return { icon: Receipt, color: 'text-text-muted', label: method ?? '—' };
  }
}

function bucketStats(rows: OrderHistoryRow[]): {
  total: number;
  cash: number;
  card: number;
  other: number;
  count: number;
} {
  const out = { total: 0, cash: 0, card: 0, other: 0, count: rows.length };
  for (const r of rows) {
    if (r.status === 'voided') continue;
    out.total += Number(r.total);
    for (const p of r.paid_by_method) {
      const amt = Number(p.amount);
      if (p.method === 'cash') out.cash += amt;
      else if (p.method === 'card' || p.method === 'debit_card' || p.method === 'credit_card') out.card += amt;
      else out.other += amt;
    }
  }
  return out;
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

  const stats = useMemo(() => bucketStats(history.data ?? []), [history.data]);

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
          <header className="h-16 flex items-center justify-between px-6 border-b border-border-subtle bg-bg-elevated">
            <div className="flex items-center gap-3">
              <div
                aria-hidden
                className="h-10 w-10 inline-flex items-center justify-center rounded-md bg-gold-soft text-gold"
              >
                <Receipt className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-display text-xl">Transaction History</h2>
                <p className="text-text-secondary text-xs">
                  {stats.count} transaction{stats.count !== 1 ? 's' : ''} this shift
                </p>
              </div>
            </div>
            <Button variant="ghost" size="icon" aria-label="Close" onClick={handleClose}>
              <X className="h-5 w-5" aria-hidden />
            </Button>
          </header>

          <div className="flex-1 grid grid-cols-[1fr_400px] overflow-hidden">
            <section className="overflow-y-auto p-4 space-y-4">
              <OrderHistoryStats stats={stats} />

              <SectionLabel size="xs" as="h3">Transactions</SectionLabel>

              {history.isLoading && <div className="text-text-secondary text-sm">Loading…</div>}
              {history.isError && <div className="text-red text-sm">Failed to load order history</div>}
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
                  const tone = paymentMethodTone(row.primary_payment_method);
                  const Icon = tone.icon;
                  return (
                    <li key={row.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(row.id)}
                        data-testid={`history-row-${row.id}`}
                        className={cn(
                          'w-full text-left rounded-md border px-4 py-3 flex items-center justify-between transition-colors',
                          isSelected
                            ? 'border-gold bg-gold-soft'
                            : 'border-border-subtle bg-bg-elevated hover:bg-bg-overlay',
                        )}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="inline-flex items-center gap-2">
                            <span className="font-mono text-base font-bold text-text-primary"># {row.order_number}</span>
                            {isVoided && <span className="text-xs text-red uppercase font-semibold">VOIDED</span>}
                            {partial && <span className="text-xs text-amber-warn uppercase font-semibold">PARTIAL REFUND</span>}
                          </div>
                          <div className="text-xs text-text-secondary mt-1 inline-flex items-center gap-2">
                            <span>
                              {row.paid_at
                                ? new Date(row.paid_at).toLocaleString(undefined, {
                                    month: '2-digit',
                                    day: '2-digit',
                                    year: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })
                                : '—'}
                            </span>
                            {row.paid_at && (
                              <span className="text-green">Paid</span>
                            )}
                            {row.order_type && (
                              <span className="px-1.5 h-5 inline-flex items-center rounded-md bg-bg-overlay text-text-secondary text-[10px] uppercase tracking-widest">
                                {row.order_type === 'takeaway' ? 'Takeaway' : row.order_type === 'dine_in' ? 'Dine-in' : row.order_type}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className={cn('inline-flex items-center gap-1 text-xs', tone.color)}>
                            <Icon className="h-3.5 w-3.5" aria-hidden />
                            <span>{tone.label}</span>
                          </span>
                          <div className="text-right">
                            <Currency amount={row.total} emphasis="gold" />
                            {row.total_refunded > 0 && (
                              <div className="text-xs text-red font-mono">
                                -<Currency amount={row.total_refunded} className="text-red" />
                              </div>
                            )}
                          </div>
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
                <div className="h-full grid place-items-center text-text-muted text-sm border-l border-border-subtle bg-bg-elevated/40">
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
