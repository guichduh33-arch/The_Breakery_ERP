// ADR-048 — un seul paiement pour plusieurs bons d'un même fournisseur.
//
// L'opérateur coche les bons, saisit le montant réellement payé et la date
// réelle du décaissement. Le serveur répartit le montant du plus ancien bon au
// plus récent : la fenêtre montre cette répartition AVANT l'envoi. Un bon sans
// facture ne peut pas être coché (le serveur le refuserait).

import { useId, useMemo, useRef, useState, type JSX } from 'react';
import { Wallet } from 'lucide-react';
import { Dialog, DialogDescription } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { Button, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/BackofficeUi.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import { formatCurrency, formatDateShortWita } from '@breakery/utils';
import { isInvoicePath } from '@/lib/invoiceFiles.js';
import { PaidAtField } from '@/features/purchasing/components/PaidAtField.js';
import type { PoPaymentMethod } from '@/features/purchasing/hooks/useRecordPoPayment.js';
import type { SupplierPOListRow } from '../hooks/useSupplierPurchases.js';
import { useRecordSupplierPayment } from '../hooks/useRecordSupplierPayment.js';

const METHODS: { value: PoPaymentMethod; label: string }[] = [
  { value: 'transfer', label: 'Bank transfer' },
  { value: 'cash',     label: 'Cash' },
  { value: 'card',     label: 'Card' },
  { value: 'qris',     label: 'QRIS' },
  { value: 'edc',      label: 'EDC' },
];

export interface PayablePo {
  id:          string;
  poNumber:    string;
  orderDate:   string | null;
  createdAt:   string;
  remaining:   number;
  hasInvoice:  boolean;
}

/** Bons qu'un paiement peut encore couvrir : non annulés, hors import, reste dû > 0. */
export function payablePos(rows: readonly SupplierPOListRow[]): PayablePo[] {
  return rows
    .filter((r) => r.status !== 'cancelled' && !r.is_historical_import && r.deleted_at === null)
    .map((r) => ({
      id: r.id,
      poNumber: r.po_number,
      orderDate: r.order_date,
      createdAt: r.created_at,
      remaining: Math.round((Number(r.total_amount ?? 0) - r.paid_amount) * 100) / 100,
      hasInvoice: r.invoice_exempt || isInvoicePath(r.invoice_path, 'purchase-orders/' + r.id + '/'),
    }))
    .filter((p) => p.remaining > 0)
    .sort(byAge);
}

/** Même ordre que le serveur : date de commande, puis création, puis identifiant. */
function byAge(a: PayablePo, b: PayablePo): number {
  const da = a.orderDate ?? '9999-12-31';
  const db = b.orderDate ?? '9999-12-31';
  if (da !== db) return da < db ? -1 : 1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}

/** Répartition du plus ancien au plus récent, comme la famille `record_supplier_payment`. */
export function allocate(selected: readonly PayablePo[], amount: number): Map<string, number> {
  const out = new Map<string, number>();
  let left = amount;
  for (const po of [...selected].sort(byAge)) {
    if (left <= 0) break;
    const part = Math.min(left, po.remaining);
    out.set(po.id, part);
    left = Math.round((left - part) * 100) / 100;
  }
  return out;
}

/** Bouton de l'onglet Payments : visible avec `purchasing.po.pay`, le serveur re-vérifie. */
export function SupplierGroupPaymentAction({
  supplierId, supplierName, rows,
}: { supplierId: string; supplierName: string; rows: readonly SupplierPOListRow[] }): JSX.Element | null {
  const canPay = useAuthStore((s) => s.hasPermission('purchasing.po.pay'));
  const [open, setOpen] = useState(false);
  if (!canPay) return null;
  const count = payablePos(rows).length;
  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)} disabled={count === 0}
        data-testid="group-pay-open">
        <Wallet className="h-4 w-4" aria-hidden /> Pay several orders
      </Button>
      {open && (
        <SupplierGroupPaymentDialog supplierId={supplierId} supplierName={supplierName} rows={rows}
          onClose={() => setOpen(false)} />
      )}
    </>
  );
}

export function SupplierGroupPaymentDialog({
  supplierId, supplierName, rows, onClose,
}: { supplierId: string; supplierName: string; rows: readonly SupplierPOListRow[]; onClose: () => void }): JSX.Element {
  const reactId = useId();
  const idempotencyKey = useRef<string>(crypto.randomUUID());
  const pay = useRecordSupplierPayment();
  const candidates = useMemo(() => payablePos(rows), [rows]);

  const [picked, setPicked]       = useState<Set<string>>(new Set());
  const [amountText, setAmountText] = useState<string>('');
  const [method, setMethod]       = useState<PoPaymentMethod>('transfer');
  const [reference, setReference] = useState<string>('');
  const [paidAt, setPaidAt]       = useState<string>('');

  const selected = candidates.filter((c) => picked.has(c.id));
  const selectedDue = Math.round(selected.reduce((acc, c) => acc + c.remaining, 0) * 100) / 100;
  // Sans saisie, le montant vaut le total dû des bons cochés.
  const amount = amountText.trim() === '' ? selectedDue : Number(amountText);
  const overpay = amount > selectedDue + 0.005;
  const split = allocate(selected, Number.isFinite(amount) ? amount : 0);
  const canSubmit = selected.length > 0 && Number.isFinite(amount) && amount > 0 && !overpay
    && paidAt.trim() !== '' && !pay.isPending;

  function toggle(id: string): void {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleConfirm(): Promise<void> {
    if (!canSubmit) return;
    try {
      await pay.mutateAsync({
        supplierId, poIds: selected.map((s) => s.id), amount, method, paidAt,
        ...(reference.trim() !== '' ? { reference: reference.trim() } : {}),
        idempotencyKey: idempotencyKey.current,
      });
      onClose();
    } catch {
      // L'erreur s'affiche ; la clé reste celle de la saisie (un nouvel essai rejoue).
    }
  }

  const label = 'font-data font-semibold text-xs uppercase tracking-widest text-text-secondary';
  const field = `h-9 w-full rounded-md border border-border-strong bg-bg-input px-3 text-sm text-text-primary ${FOCUS_RING}`;

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !pay.isPending) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Pay several purchase orders</DialogTitle>
          <DialogDescription>
            One payment to {supplierName}. The amount goes to the oldest selected order first.
          </DialogDescription>
        </DialogHeader>

        {candidates.length === 0 ? (
          <p className="text-sm text-text-secondary">No purchase order of this supplier has an amount left to pay.</p>
        ) : (
          <fieldset className="space-y-1">
            <legend className={label}>Purchase orders</legend>
            <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-border-subtle p-2" data-testid="group-pay-list">
              {candidates.map((c) => (
                <li key={c.id}>
                  <label className={`flex items-center gap-2 rounded px-1 py-1 text-sm ${c.hasInvoice ? '' : 'text-text-muted'}`}>
                    <input
                      type="checkbox"
                      checked={picked.has(c.id)}
                      disabled={!c.hasInvoice || pay.isPending}
                      onChange={() => toggle(c.id)}
                      className={FOCUS_RING}
                    />
                    <span className="font-data tabular-nums">{c.poNumber}</span>
                    <span className="text-xs text-text-secondary">
                      {c.orderDate !== null ? formatDateShortWita(c.orderDate) : '—'}
                      {!c.hasInvoice && ' · invoice missing'}
                    </span>
                    <span className="ml-auto font-data tabular-nums">
                      {split.has(c.id) ? `${formatCurrency(split.get(c.id) ?? 0)} of ` : ''}{formatCurrency(c.remaining)}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        )}

        <div className="space-y-3">
          <div className="space-y-1">
            <label htmlFor={`${reactId}-amount`} className={label}>Amount (Rp)</label>
            <input
              id={`${reactId}-amount`}
              type="number" min={0} step={1}
              value={amountText === '' ? (selectedDue > 0 ? String(selectedDue) : '') : amountText}
              onChange={(e) => setAmountText(e.target.value)}
              disabled={pay.isPending}
              className={field}
              aria-required="true"
              data-testid="group-pay-amount"
            />
            <p className={`text-xs ${overpay ? 'text-danger' : 'text-text-secondary'}`}>
              {overpay ? 'Amount exceeds the total left on the selected orders.' : `Selected orders: ${formatCurrency(selectedDue)} left to pay.`}
            </p>
          </div>

          <PaidAtField id={`${reactId}-paid-at`} value={paidAt} onChange={setPaidAt} disabled={pay.isPending} />

          <div className="space-y-1">
            <label htmlFor={`${reactId}-method`} className={label}>Method</label>
            <select id={`${reactId}-method`} value={method} disabled={pay.isPending} className={field}
              onChange={(e) => setMethod(e.target.value as PoPaymentMethod)}>
              {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>

          <div className="space-y-1">
            <label htmlFor={`${reactId}-ref`} className={label}>Reference (optional)</label>
            <input id={`${reactId}-ref`} type="text" maxLength={100} value={reference} disabled={pay.isPending}
              onChange={(e) => setReference(e.target.value)} placeholder="e.g. transfer ref"
              className={`${field} placeholder:text-text-muted`} />
          </div>

          {pay.error !== null && (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
              {pay.error.message}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={pay.isPending}>Cancel</Button>
          <Button type="button" variant="ink" onClick={() => { void handleConfirm(); }} disabled={!canSubmit}
            data-testid="group-pay-submit">
            {pay.isPending ? 'Recording…' : `Record payment${selected.length > 1 ? ` for ${selected.length} orders` : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
