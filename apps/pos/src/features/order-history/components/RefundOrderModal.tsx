// apps/pos/src/features/order-history/components/RefundOrderModal.tsx
//
// Session 10 — partial line refund flow. Three steps inline:
//   1. Pick lines + qty (RefundLineRow rows)
//   2. Distribute refund total across original tenders (RefundTenderSplitter)
//   3. Reason + manager PIN
// Submit hits refund-order EF.

import { useMemo, useState, type JSX } from 'react';
import { X } from 'lucide-react';
import {
  Button, NumpadPin, FullScreenModal, cn, Input, Currency,
  RefundLineRow, RefundTenderSplitter,
  type RefundTenderSplitterEntry,
  type TenderRowMethod,
} from '@breakery/ui';
import {
  computeRefundLineAmount,
  validateRefundDraft,
  type RefundableItem,
  type MethodLedgerEntry,
  type RefundTender,
  type PaymentMethod,
} from '@breakery/domain';
import { toast } from 'sonner';
import type { OrderDetail } from '../hooks/useOrderDetail';

export interface RefundOrderModalProps {
  open: boolean;
  onClose: () => void;
  order: OrderDetail;
  onSubmit: (args: {
    lines: Array<{ order_item_id: string; qty: number }>;
    tenders: Array<{ method: PaymentMethod; amount: number }>;
    reason: string;
    managerPin: string;
  }) => Promise<void> | void;
  isPending?: boolean;
}

export function RefundOrderModal({
  open, onClose, order, onSubmit, isPending = false,
}: RefundOrderModalProps): JSX.Element {
  // qty selected per order_item_id (0 = not selected)
  const [selectedQty, setSelectedQty] = useState<Map<string, number>>(new Map());
  const [tenderValues, setTenderValues] = useState<RefundTenderSplitterEntry[]>([]);
  const [reason, setReason] = useState('');
  const [pinKey, setPinKey] = useState(0);

  const refundableItems: RefundableItem[] = useMemo(() => order.items.map((it) => ({
    order_item_id: it.id,
    quantity: it.quantity,
    line_total: it.line_total,
    qty_already_refunded: it.qty_already_refunded,
    is_cancelled: it.is_cancelled,
  })), [order.items]);

  const itemsById = useMemo(
    () => new Map(refundableItems.map((it) => [it.order_item_id, it])),
    [refundableItems],
  );

  const refundTotal = useMemo(() => {
    let s = 0;
    for (const [oiId, qty] of selectedQty.entries()) {
      if (qty <= 0) continue;
      const it = itemsById.get(oiId);
      if (it) s += computeRefundLineAmount(it, qty);
    }
    return s;
  }, [selectedQty, itemsById]);

  const methodLedger: MethodLedgerEntry[] = useMemo(() => {
    const paidByMethod = new Map<PaymentMethod, number>();
    for (const p of order.payments) {
      paidByMethod.set(p.method, (paidByMethod.get(p.method) ?? 0) + p.amount);
    }
    return Array.from(paidByMethod.entries()).map(([method, paid]) => ({
      method,
      paid,
      refunded: order.refunded_by_method[method] ?? 0,
    }));
  }, [order.payments, order.refunded_by_method]);

  const draftLines = useMemo(
    () =>
      Array.from(selectedQty.entries())
        .filter(([, q]) => q > 0)
        .map(([order_item_id, qty]) => ({ order_item_id, qty })),
    [selectedQty],
  );

  const draftTenders: RefundTender[] = useMemo(
    () => tenderValues.map((v) => ({ method: v.method as PaymentMethod, amount: v.amount })),
    [tenderValues],
  );

  const validation = useMemo(() => {
    if (draftLines.length === 0 || draftTenders.length === 0) return null;
    return validateRefundDraft({
      draft_lines: draftLines,
      draft_tenders: draftTenders,
      reason: reason.trim() || 'placeholder',  // reason validated separately at submit
      items_by_id: itemsById,
      order_total: order.total,
      prior_refunds_total: order.total_refunded,
      method_ledger: methodLedger,
    });
  }, [draftLines, draftTenders, reason, itemsById, order.total, order.total_refunded, methodLedger]);

  const canSubmit =
    refundTotal > 0
    && reason.trim().length >= 3
    && validation !== null
    && validation.ok === true;

  function handleClose(): void {
    setSelectedQty(new Map());
    setTenderValues([]);
    setReason('');
    setPinKey((k) => k + 1);
    onClose();
  }

  async function handlePinSubmit(pin: string): Promise<void> {
    if (!canSubmit) {
      toast.error(
        validation && !validation.ok
          ? `${validation.error}${validation.detail ? ` — ${validation.detail}` : ''}`
          : 'Refund draft incomplete',
      );
      setPinKey((k) => k + 1);
      return;
    }
    try {
      await onSubmit({
        lines: draftLines,
        tenders: draftTenders.map((t) => ({ method: t.method, amount: t.amount })),
        reason: reason.trim(),
        managerPin: pin,
      });
      handleClose();
    } catch {
      setPinKey((k) => k + 1);
    }
  }

  function handleQtyChange(oiId: string, qty: number): void {
    setSelectedQty((prev) => {
      const next = new Map(prev);
      if (qty <= 0) next.delete(oiId);
      else next.set(oiId, qty);
      return next;
    });
  }

  return (
    <FullScreenModal open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <div
        role="dialog"
        aria-label={`Refund lines on order ${order.order_number}`}
        className="flex flex-col h-screen bg-bg-base"
      >
        <header className="h-14 flex items-center justify-between px-6 border-b border-border-subtle bg-bg-elevated">
          <div className="flex items-baseline gap-3">
            <span className="font-serif text-lg">Refund lines</span>
            <span className="text-text-secondary text-sm">on {order.order_number}</span>
          </div>
          <button type="button" aria-label="Close" onClick={handleClose} className="text-text-secondary hover:text-text-primary">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <section>
            <div className="text-xs uppercase tracking-widest text-text-secondary mb-3">
              Lines to refund
            </div>
            <div className="rounded-md border border-border-subtle bg-bg-elevated">
              {order.items.map((it) => {
                const qty = selectedQty.get(it.id) ?? 0;
                const refundableItem = itemsById.get(it.id)!;
                const amount = computeRefundLineAmount(refundableItem, qty);
                return (
                  <RefundLineRow
                    key={it.id}
                    item={{
                      order_item_id: it.id,
                      name: it.name_snapshot,
                      quantity: it.quantity,
                      line_total: it.line_total,
                      qty_already_refunded: it.qty_already_refunded,
                      is_cancelled: it.is_cancelled,
                    }}
                    selectedQty={qty}
                    refundAmount={amount}
                    onChange={(q) => handleQtyChange(it.id, q)}
                  />
                );
              })}
            </div>
          </section>

          <section>
            <RefundTenderSplitter
              refundTotal={refundTotal}
              methods={methodLedger.map((m) => ({
                method: m.method as TenderRowMethod,
                paid: m.paid,
                already_refunded: m.refunded,
              }))}
              values={tenderValues}
              onChange={setTenderValues}
            />
            {validation && !validation.ok && draftLines.length > 0 && draftTenders.length > 0 && (
              <div className="mt-2 text-xs text-red-400">
                {validation.error}{validation.detail ? ` — ${validation.detail}` : ''}
              </div>
            )}
          </section>

          <section>
            <label className="text-xs uppercase tracking-widest text-text-secondary mb-2 block">
              Reason
            </label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. spilled latte, customer return…"
              className={cn('w-full', reason.trim().length > 0 && reason.trim().length < 3 && 'border-red-400')}
              disabled={isPending}
            />
            {reason.length > 0 && reason.trim().length < 3 && (
              <div className="mt-1 text-xs text-red-400">Reason must be at least 3 characters</div>
            )}
          </section>

          <section>
            <div className="text-xs uppercase tracking-widest text-text-secondary mb-2">
              Manager PIN
            </div>
            <NumpadPin
              key={pinKey}
              maxLength={6}
              onSubmit={(pin) => { void handlePinSubmit(pin); }}
              isLoading={isPending || !canSubmit}
            />
          </section>
        </div>

        <footer className="h-16 flex items-center justify-between px-6 border-t border-border-subtle bg-bg-elevated">
          <Button variant="secondary" onClick={handleClose}>Cancel</Button>
          <div className="text-sm text-text-secondary">
            Refund total: <Currency amount={refundTotal} emphasis="gold" className="text-text-primary" />
          </div>
        </footer>
      </div>
    </FullScreenModal>
  );
}
