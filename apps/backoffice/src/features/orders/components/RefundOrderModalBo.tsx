// apps/backoffice/src/features/orders/components/RefundOrderModalBo.tsx
//
// Lot 6c — modale de remboursement partiel côté BACK-OFFICE (thème ivoire).
//
// Elle réutilise la LOGIQUE de domaine du refund (`computeRefundBreakdown`,
// `validateRefundDraft`) — la même que le POS — mais un rendu theme-backoffice :
// pas de FullScreenModal ni de NumpadPin (surfaces tablette luxe-dark du POS),
// un Dialog centré et des primitives natives, à l'image de VoidOrderModal.
//
// Contrainte cross-shift (socle v10) : l'opérateur BO n'a pas de session
// ouverte. On ne propose donc QUE les tenders non-cash présents sur la commande
// et, en échappatoire, le store credit (si un client est rattaché). Le cash est
// masqué avec une note explicite ; le serveur reste l'autorité (P0015/P0016).

import { useEffect, useMemo, useState, type JSX } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogDescription } from '@breakery/ui';
import { Button, DialogContent, DialogTitle } from '@/components/BackofficeUi.js';
import { Minus, Plus, Undo2 } from 'lucide-react';
import { formatCurrency } from '@breakery/utils';
import {
  computeRefundBreakdown,
  validateRefundDraft,
  type RefundableItem,
  type MethodLedgerEntry,
  type PaymentMethod,
} from '@breakery/domain';
import { PAYMENT_METHOD_LABEL } from '@/features/orders/statusMeta.js';
import { useRefundOrder } from '@/features/orders/hooks/useRefundOrder.js';
import type { OrderDetail } from '@/features/orders/hooks/useOrderDetail.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import { useAuthStore } from '@/stores/authStore.js';
import { useFinancialAttempt } from '@/lib/useFinancialAttempt.js';
import { PENDING_MESSAGE } from '@/lib/pendingFinancialAttempts.js';

interface Props {
  open: boolean;
  onClose: () => void;
  order: OrderDetail;
}

function methodLabel(method: string): string {
  return (PAYMENT_METHOD_LABEL as Record<string, string>)[method] ?? method;
}

export function RefundOrderModalBo({ open, onClose, order }: Props): JSX.Element {
  const [draftQty, setSelectedQty] = useState<Map<string, number>>(new Map());
  const [method, setMethod] = useState<string>('');
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const m = useRefundOrder();
  const attempt = useFinancialAttempt('refund', order.id, open);
  const snapshot = attempt.pending?.payload;
  const selectedQty = useMemo(() => snapshot ? new Map(snapshot.lines.map((line) => [line.order_item_id, line.qty])) : draftQty, [snapshot, draftQty]);
  const [formError, setFormError] = useState<string | null>(null);
  const sessionToken = useAuthStore((s) => s.sessionToken);
  useEffect(() => {
    setSelectedQty(new Map()); setMethod(''); setReason(''); setPin(''); setFormError(null);
  }, [open, order.id, sessionToken]);
  const frozen = Boolean(snapshot) || attempt.busy;

  const hasCustomer = order.customer_id != null;
  const refundedByMethod = useMemo(() => order.refunded_by_method ?? {}, [order.refunded_by_method]);

  // Lignes remboursables : on exclut les lignes annulées (jamais encaissées).
  const refundableItems: RefundableItem[] = useMemo(
    () =>
      order.items
        .filter((it) => !it.is_cancelled)
        .map((it) => ({
          order_item_id: it.id,
          quantity: it.quantity,
          line_total: it.line_total,
          qty_already_refunded: it.qty_already_refunded,
          is_cancelled: it.is_cancelled,
        })),
    [order.items],
  );

  const itemsById = useMemo(
    () => new Map(refundableItems.map((it) => [it.order_item_id, it])),
    [refundableItems],
  );

  const refundQuote = useMemo(() => computeRefundBreakdown(
    Array.from(selectedQty.entries()).filter(([, qty]) => qty > 0)
      .map(([order_item_id, qty]) => ({ order_item_id, qty })),
    itemsById, { order_total: order.total, prior_refunds_total: order.total_refunded,
      points_redeemed: order.loyalty_points_redeemed ?? 0 },
  ), [selectedQty, itemsById, order.total, order.total_refunded, order.loyalty_points_redeemed]);
  const refundTotal = snapshot
    ? snapshot.tenders.reduce((sum, tender) => sum + tender.amount, 0)
    : refundQuote.total;
  const pointsOnly = !snapshot && refundTotal === 0 && refundQuote.points_restored > 0;

  // Montant payé par méthode (pour le plafond par tender des méthodes d'origine).
  const paidByMethod = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of order.payments) {
      map.set(p.method, (map.get(p.method) ?? 0) + p.amount);
    }
    return map;
  }, [order.payments]);

  // Destinations éligibles : méthodes NON-CASH d'origine avec un reste > 0,
  // plus le store credit (échappatoire, si un client est rattaché).
  const nonCashOptions = useMemo(
    () =>
      Array.from(paidByMethod.entries())
        .filter(([mth]) => mth !== 'cash')
        .map(([mth, paid]) => ({ method: mth, available: paid - (refundedByMethod[mth] ?? 0) }))
        .filter((e) => e.available > 0),
    [paidByMethod, refundedByMethod],
  );

  const hadCashOnly = paidByMethod.has('cash') && nonCashOptions.length === 0;

  // Défaut : première méthode non-cash, sinon store credit si un client existe.
  const defaultMethod = nonCashOptions[0]?.method ?? (hasCustomer ? 'store_credit' : '');
  const effectiveMethod = snapshot?.tenders[0]?.method ?? (method || defaultMethod);

  const draftLines = useMemo(
    () =>
      Array.from(selectedQty.entries())
        .filter(([, q]) => q > 0)
        .map(([order_item_id, qty]) => ({ order_item_id, qty })),
    [selectedQty],
  );

  // Ledger de validation : store credit est frappé neuf (pas routé vers un
  // tender existant) → son plafond par méthode = le total remboursé ; le
  // plafond GLOBAL (cap_exceeded) reste vérifié par validateRefundDraft.
  const methodLedger: MethodLedgerEntry[] = useMemo(() => {
    if (!effectiveMethod) return [];
    if (effectiveMethod === 'store_credit') {
      return [{ method: 'store_credit', paid: refundTotal, refunded: 0 }];
    }
    return [
      {
        method: effectiveMethod as PaymentMethod,
        paid: paidByMethod.get(effectiveMethod) ?? 0,
        refunded: refundedByMethod[effectiveMethod] ?? 0,
      },
    ];
  }, [effectiveMethod, refundTotal, paidByMethod, refundedByMethod]);

  const validation = useMemo(() => {
    if (draftLines.length === 0 || (!pointsOnly && (!effectiveMethod || refundTotal <= 0))) return null;
    return validateRefundDraft({
      draft_lines: draftLines,
      draft_tenders: pointsOnly ? [] : [{ method: effectiveMethod as PaymentMethod, amount: refundTotal }],
      reason: reason.trim() || 'placeholder',
      items_by_id: itemsById,
      order_total: order.total,
      prior_refunds_total: order.total_refunded,
      loyalty_points_redeemed: order.loyalty_points_redeemed ?? 0,
      method_ledger: methodLedger,
    });
  }, [draftLines, effectiveMethod, refundTotal, reason, itemsById, order.total, order.total_refunded, order.loyalty_points_redeemed, methodLedger, pointsOnly]);

  const reasonOk = reason.trim().length >= 3;
  const pinOk = /^\d{6}$/.test(pin);
  const canSubmit =
    attempt.allowed && !attempt.storageError && !attempt.busy && (snapshot ? pinOk : ((refundTotal > 0 || pointsOnly) &&
    (effectiveMethod !== '' || pointsOnly) &&
    reasonOk &&
    pinOk &&
    validation?.ok === true));

  function handleQty(oiId: string, next: number): void {
    setSelectedQty((prev) => {
      const map = new Map(prev);
      if (next <= 0) map.delete(oiId);
      else map.set(oiId, next);
      return map;
    });
  }

  function handleClose(): void {
    setSelectedQty(new Map());
    setMethod('');
    setReason('');
    setPin('');
    setFormError(null);
    onClose();
  }

  async function handleSubmit(): Promise<void> {
    if (!canSubmit) return;
    const managerPin = pin;
    setPin('');
    setFormError(null);
    const outcome = await attempt.submit(snapshot ?? {
        orderId: order.id,
        lines: draftLines,
        tenders: pointsOnly ? [] : [{ method: effectiveMethod, amount: refundTotal }],
        reason: reason.trim(),
      }, (payload, key, current) => m.mutateAsync({ ...payload, managerPin, idempotencyKey: key, sessionGuard: current }));
    if (!outcome.current) return;
    if ('result' in outcome) {
      toast.success(`Refund ${outcome.result.refund_number} recorded`);
      handleClose();
    } else {
      setFormError(outcome.error instanceof Error ? outcome.error.message : 'Refund result unconfirmed. Please check the pending attempt.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-lg" data-testid="refund-modal-bo">
        <DialogTitle className="flex items-center gap-2">
          <Undo2 className="h-4 w-4 text-danger" aria-hidden />
          Refund order #{order.order_number.replace(/^#+/, '')}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Refund selected lines back to a non-cash tender or as store credit.
        </DialogDescription>
        {snapshot && <p role="status" className="text-sm text-warning">{PENDING_MESSAGE}</p>}
        {snapshot && <p className="text-xs text-text-secondary">Saved lines: {snapshot.lines.map((line) => `${line.order_item_id} × ${line.qty}`).join(', ')}</p>}

        {!snapshot && refundQuote.points_restored > 0 && <p role="status">Points to restore: {refundQuote.points_restored}</p>}
        {/* Lignes à rembourser */}
        <div>
          <div className="font-data text-xs font-semibold uppercase tracking-widest text-text-muted">
            Lines to refund
          </div>
          <ul className="mt-2 max-h-56 divide-y divide-border-row overflow-y-auto rounded-md border border-border-subtle">
            {refundableItems.map((it) => {
              const full = order.items.find((o) => o.id === it.order_item_id);
              const remaining = Math.max(0, Math.round((it.quantity - it.qty_already_refunded) * 1000) / 1000);
              const qty = selectedQty.get(it.order_item_id) ?? 0;
              const amount = refundQuote.line_amounts.get(it.order_item_id) ?? 0;
              const exhausted = remaining <= 0;
              return (
                <li key={it.order_item_id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                  <span className="flex-1 truncate text-text-primary">{full?.name_snapshot ?? it.order_item_id}</span>
                  {it.qty_already_refunded > 0 && (
                    <span className="font-data text-xs text-text-muted">
                      {it.qty_already_refunded}/{it.quantity} refunded
                    </span>
                  )}
                  {exhausted ? (
                    <span className="font-data text-xs uppercase tracking-widest text-text-muted">Fully refunded</span>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        aria-label={`Decrease ${full?.name_snapshot ?? ''}`}
                        className="flex h-6 w-6 items-center justify-center rounded-sm border border-border-strong text-text-secondary disabled:opacity-40"
                        disabled={frozen || qty <= 0}
                        onClick={() => handleQty(it.order_item_id, qty - 1)}
                      >
                        <Minus className="h-3 w-3" aria-hidden />
                      </button>
                      <span className="w-8 text-center font-data tabular-nums text-text-primary">{qty}</span>
                      <button
                        type="button"
                        aria-label={`Increase ${full?.name_snapshot ?? ''}`}
                        className="flex h-6 w-6 items-center justify-center rounded-sm border border-border-strong text-text-secondary disabled:opacity-40"
                        disabled={frozen || qty >= remaining}
                        onClick={() => handleQty(it.order_item_id, Math.min(remaining, qty + 1))}
                      >
                        <Plus className="h-3 w-3" aria-hidden />
                      </button>
                    </div>
                  )}
                  <span className="w-24 text-right font-data tabular-nums text-text-primary">
                    {qty > 0 ? formatCurrency(amount) : '—'}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Destination du remboursement */}
        {pointsOnly || snapshot?.tenders.length === 0 ? <p>No money remains to refund. Only the remaining loyalty points will be restored.</p> : <div>
          <label htmlFor="refund-method-bo" className="block font-data text-xs font-semibold uppercase tracking-widest text-text-muted">
            Refund destination
          </label>
          <select
            id="refund-method-bo"
            value={effectiveMethod}
            disabled={frozen}
            onChange={(e) => setMethod(e.target.value)}
            className={`mt-1 w-full rounded border border-border-strong bg-bg-elevated p-2 text-sm text-text-primary ${FOCUS_RING}`}
            data-testid="refund-method"
          >
            {snapshot && <option value={effectiveMethod}>{methodLabel(effectiveMethod)} — saved refund destination</option>}
            {nonCashOptions.length === 0 && !hasCustomer && (
              <option value="" disabled>
                No eligible destination
              </option>
            )}
            {nonCashOptions.map((o) => (
              <option key={o.method} value={o.method}>
                {methodLabel(o.method)} — {formatCurrency(o.available)} available
              </option>
            ))}
            <option value="store_credit" disabled={!hasCustomer}>
              Store credit{hasCustomer ? '' : ' (requires a customer)'}
            </option>
          </select>
          {/* Note cross-shift : le cash n'est jamais proposé depuis le BO. */}
          <p className="mt-1 text-xs text-text-muted">
            Cash refunds require an open register (POS) and are unavailable here.
          </p>
          {!snapshot && hadCashOnly && !hasCustomer && (
            <p className="mt-1 text-xs text-danger">
              This order was paid in cash and has no customer for store credit — it cannot be refunded from the back-office.
            </p>
          )}
        </div>}

        {/* Motif */}
        <div>
          <label htmlFor="refund-reason-bo" className="block text-sm font-medium">Reason</label>
          <input
            id="refund-reason-bo"
            value={snapshot?.reason ?? reason}
            disabled={frozen}
            onChange={(e) => setReason(e.target.value)}
            className={`mt-1 w-full rounded border border-border-strong p-2 text-sm placeholder:text-text-muted ${FOCUS_RING}`}
            placeholder="Min. 3 characters…"
            data-testid="refund-reason"
          />
          {!snapshot && !reasonOk && reason.length > 0 && <p className="mt-1 text-xs text-danger">Min. 3 characters</p>}
        </div>

        {/* PIN manager */}
        <div>
          <label htmlFor="refund-pin-bo" className="block text-sm font-medium">Manager PIN</label>
          <input
            id="refund-pin-bo"
            type="password"
            autoComplete="off"
            inputMode="numeric"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            className={`mt-1 w-full rounded border border-border-strong p-2 text-sm tracking-widest ${FOCUS_RING}`}
            data-testid="refund-pin"
          />
        </div>

        {!snapshot && validation && !validation.ok && draftLines.length > 0 && (
          <p className="text-xs text-danger" data-testid="refund-validation">
            {validation.error}{validation.detail ? ` — ${validation.detail}` : ''}
          </p>
        )}
        {(formError ?? attempt.storageError) && <p role="alert" className="text-sm text-danger" data-testid="refund-error">{formError ?? attempt.storageError}</p>}

        <div className="flex items-center justify-between">
          <span className="text-sm text-text-secondary">
            Refund total:{' '}
            <span className="font-data tabular-nums text-text-primary">{formatCurrency(refundTotal)}</span>
          </span>
          {/* Même correctif que `VoidOrderModal` : primitif partagé pour les
              boutons de modale, et l'aplat rouge NEUTRALISE sa couleur au lieu
              de se faner (`disabled:opacity-50` rendait un bouton mort à
              l'allure vivante, sur le geste le plus irréversible de l'écran). */}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleClose}
              data-testid="refund-cancel"
            >
              {snapshot || attempt.busy ? 'Close' : 'Cancel'}
            </Button>
            <Button
              type="button"
              variant="ink"
              size="sm"
              className="bg-danger text-danger-fg hover:bg-danger-hover"
              onClick={() => { void handleSubmit(); }}
              disabled={!canSubmit}
              data-testid="refund-submit"
            >
              {attempt.busy ? 'Refunding…' : snapshot ? 'Check pending refund' : 'Refund'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
