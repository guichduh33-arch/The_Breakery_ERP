// apps/backoffice/src/features/orders/components/RefundOrderModalBo.tsx
//
// Lot 6c — modale de remboursement partiel côté BACK-OFFICE (thème ivoire).
//
// Elle réutilise la LOGIQUE de domaine du refund (`computeRefundLineAmount`,
// `validateRefundDraft`) — la même que le POS — mais un rendu theme-backoffice :
// pas de FullScreenModal ni de NumpadPin (surfaces tablette luxe-dark du POS),
// un Dialog centré et des primitives natives, à l'image de VoidOrderModal.
//
// Contrainte cross-shift (socle v10) : l'opérateur BO n'a pas de session
// ouverte. On ne propose donc QUE les tenders non-cash présents sur la commande
// et, en échappatoire, le store credit (si un client est rattaché). Le cash est
// masqué avec une note explicite ; le serveur reste l'autorité (P0015/P0016).

import { useMemo, useRef, useState, type JSX } from 'react';
import { toast } from 'sonner';
import { Button, Dialog, DialogContent, DialogTitle, DialogDescription } from '@breakery/ui';
import { Minus, Plus, Undo2 } from 'lucide-react';
import { formatCurrency } from '@breakery/utils';
import {
  computeRefundLineAmount,
  validateRefundDraft,
  type RefundableItem,
  type MethodLedgerEntry,
  type PaymentMethod,
} from '@breakery/domain';
import { PAYMENT_METHOD_LABEL } from '@/features/orders/statusMeta.js';
import { useRefundOrder } from '@/features/orders/hooks/useRefundOrder.js';
import type { OrderDetail } from '@/features/orders/hooks/useOrderDetail.js';
import { FOCUS_RING } from '@/components/focusRing.js';

interface Props {
  open: boolean;
  onClose: () => void;
  order: OrderDetail;
}

function methodLabel(method: string): string {
  return (PAYMENT_METHOD_LABEL as Record<string, string>)[method] ?? method;
}

export function RefundOrderModalBo({ open, onClose, order }: Props): JSX.Element {
  const [selectedQty, setSelectedQty] = useState<Map<string, number>>(new Map());
  const [method, setMethod] = useState<string>('');
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  // Une clé par ouverture de modale — stable aux re-renders et aux retries.
  const idem = useRef(crypto.randomUUID());
  const m = useRefundOrder();

  const hasCustomer = order.customer_id != null;
  const refundedByMethod = order.refunded_by_method ?? {};

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

  const refundTotal = useMemo(() => {
    let s = 0;
    for (const [oiId, qty] of selectedQty.entries()) {
      if (qty <= 0) continue;
      const it = itemsById.get(oiId);
      if (it) s += computeRefundLineAmount(it, qty);
    }
    return s;
  }, [selectedQty, itemsById]);

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
  const effectiveMethod = method || defaultMethod;

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
    if (draftLines.length === 0 || !effectiveMethod || refundTotal <= 0) return null;
    return validateRefundDraft({
      draft_lines: draftLines,
      draft_tenders: [{ method: effectiveMethod as PaymentMethod, amount: refundTotal }],
      reason: reason.trim() || 'placeholder',
      items_by_id: itemsById,
      order_total: order.total,
      prior_refunds_total: order.total_refunded,
      method_ledger: methodLedger,
    });
  }, [draftLines, effectiveMethod, refundTotal, reason, itemsById, order.total, order.total_refunded, methodLedger]);

  const reasonOk = reason.trim().length >= 3;
  const pinOk = /^\d{6}$/.test(pin);
  const canSubmit =
    refundTotal > 0 &&
    effectiveMethod !== '' &&
    reasonOk &&
    pinOk &&
    validation?.ok === true &&
    !m.isPending;

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
    idem.current = crypto.randomUUID();
    onClose();
  }

  async function handleSubmit(): Promise<void> {
    if (!canSubmit) return;
    try {
      const res = await m.mutateAsync({
        orderId: order.id,
        lines: draftLines,
        tenders: [{ method: effectiveMethod, amount: refundTotal }],
        reason: reason.trim(),
        managerPin: pin,
        idempotencyKey: idem.current,
      });
      toast.success(`Refund ${res.refund_number} recorded`);
      handleClose();
    } catch {
      // m.error rendu sous le formulaire ; on garde la modale ouverte.
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

        {/* Lignes à rembourser */}
        <div>
          <div className="font-data text-xs font-semibold uppercase tracking-widest text-text-muted">
            Lines to refund
          </div>
          <ul className="mt-2 max-h-56 divide-y divide-border-row overflow-y-auto rounded-md border border-border-subtle">
            {refundableItems.map((it) => {
              const full = order.items.find((o) => o.id === it.order_item_id);
              const remaining = it.quantity - it.qty_already_refunded;
              const qty = selectedQty.get(it.order_item_id) ?? 0;
              const amount = computeRefundLineAmount(it, qty);
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
                        disabled={qty <= 0}
                        onClick={() => handleQty(it.order_item_id, qty - 1)}
                      >
                        <Minus className="h-3 w-3" aria-hidden />
                      </button>
                      <span className="w-8 text-center font-data tabular-nums text-text-primary">{qty}</span>
                      <button
                        type="button"
                        aria-label={`Increase ${full?.name_snapshot ?? ''}`}
                        className="flex h-6 w-6 items-center justify-center rounded-sm border border-border-strong text-text-secondary disabled:opacity-40"
                        disabled={qty >= remaining}
                        onClick={() => handleQty(it.order_item_id, qty + 1)}
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
        <div>
          <label htmlFor="refund-method-bo" className="block font-data text-xs font-semibold uppercase tracking-widest text-text-muted">
            Refund destination
          </label>
          <select
            id="refund-method-bo"
            value={effectiveMethod}
            onChange={(e) => setMethod(e.target.value)}
            className={`mt-1 w-full rounded border border-border-strong bg-bg-elevated p-2 text-sm text-text-primary ${FOCUS_RING}`}
            data-testid="refund-method"
          >
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
          {hadCashOnly && !hasCustomer && (
            <p className="mt-1 text-xs text-danger">
              This order was paid in cash and has no customer for store credit — it cannot be refunded from the back-office.
            </p>
          )}
        </div>

        {/* Motif */}
        <div>
          <label htmlFor="refund-reason-bo" className="block text-sm font-medium">Reason</label>
          <input
            id="refund-reason-bo"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={`mt-1 w-full rounded border border-border-strong p-2 text-sm placeholder:text-text-muted ${FOCUS_RING}`}
            placeholder="Min. 3 characters…"
            data-testid="refund-reason"
          />
          {!reasonOk && reason.length > 0 && <p className="mt-1 text-xs text-danger">Min. 3 characters</p>}
        </div>

        {/* PIN manager */}
        <div>
          <label htmlFor="refund-pin-bo" className="block text-sm font-medium">Manager PIN</label>
          <input
            id="refund-pin-bo"
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            className={`mt-1 w-full rounded border border-border-strong p-2 text-sm tracking-widest ${FOCUS_RING}`}
            data-testid="refund-pin"
          />
        </div>

        {validation && !validation.ok && draftLines.length > 0 && (
          <p className="text-xs text-danger" data-testid="refund-validation">
            {validation.error}{validation.detail ? ` — ${validation.detail}` : ''}
          </p>
        )}
        {m.error && <p className="text-sm text-danger" data-testid="refund-error">{m.error.message}</p>}

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
              Cancel
            </Button>
            <Button
              type="button"
              variant="ink"
              size="sm"
              className="bg-danger text-red-on-fill hover:opacity-90"
              onClick={() => { void handleSubmit(); }}
              disabled={!canSubmit}
              data-testid="refund-submit"
            >
              {m.isPending ? 'Refunding…' : 'Refund'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
