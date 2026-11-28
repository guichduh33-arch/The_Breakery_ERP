// Carte « Payment Status » du bon de commande : totaux, historique des
// paiements, enregistrement et contre-passation (ADR-048).
//
// L'historique montre la vérité du grand livre : une contre-passation est une
// ligne négative, le paiement qu'elle annule reste visible et marqué. Le bouton
// « Reverse » n'apparaît qu'au super admin ; le serveur re-vérifie tout.

import { useState, type JSX } from 'react';
import { Undo2, Wallet } from 'lucide-react';
import { Badge } from '@breakery/ui';
import { formatCurrency } from '@breakery/utils';
import { PO_DATE_HINTS, PO_DATE_LABELS, formatPoDay, formatPoInstant } from '../poVocabulary.js';
import { Button, Card } from '@/components/BackofficeUi.js';
import { SectionLabel } from '@/components/SectionLabel.js';
import { useAuthStore } from '@/stores/authStore.js';
import { INVOICE_PAYMENT_MESSAGE } from '@/lib/invoiceFiles.js';
import { usePaymentGroup, type PoPaymentRow, type PoPaymentStatus } from '../hooks/usePoPayments.js';
import { SummaryRow } from './PurchaseOrderDetailCards.js';
import { PaymentStatusBadge } from './PoPaymentBadge.js';
import { ReversePaymentDialog } from './ReversePaymentDialog.js';

interface Props {
  poId:               string;
  poNumber:           string;
  totalDue:           number;
  totalPaid:          number;
  remainingDue:       number;
  paymentStatus:      PoPaymentStatus;
  payments:           PoPaymentRow[] | undefined;
  canRecordPay:       boolean;
  payBlockedByCancel: boolean;
  invoiceBlocked:     boolean;
  onRecordPayment:    () => void;
}

export function PoPaymentsCard({
  poId, poNumber, totalDue, totalPaid, remainingDue, paymentStatus, payments,
  canRecordPay, payBlockedByCancel, invoiceBlocked, onRecordPayment,
}: Props): JSX.Element {
  const isOwner = useAuthStore((s) => s.user?.role_code === 'SUPER_ADMIN');
  const [toReverse, setToReverse] = useState<PoPaymentRow | null>(null);
  const rows = payments ?? [];
  const reversedIds = new Set(rows.flatMap((p) => (p.reversal_of_id !== null ? [p.reversal_of_id] : [])));

  return (
    <Card variant="default" padding="md" className="space-y-3">
      <div className="flex items-center justify-between">
        <SectionLabel as="h2" size="sm" className="text-gold">Payment Status</SectionLabel>
        {/* Un bon annulé sans paiement n'est pas « Unpaid » : il ne doit rien. */}
        {payBlockedByCancel && totalPaid === 0
          ? <span className="text-xs text-text-muted">No payment due</span>
          : <PaymentStatusBadge status={paymentStatus} />}
      </div>
      <dl className="space-y-2 text-sm">
        <SummaryRow label="Total due"  value={formatCurrency(totalDue)} />
        <SummaryRow label="Paid"       value={formatCurrency(totalPaid)} />
        <SummaryRow label="Remaining"  value={formatCurrency(remainingDue)} />
      </dl>

      {rows.length > 0 && (
        <div className="space-y-1 border-t border-border-subtle pt-3">
          <SectionLabel as="div" size="xs">Payment history</SectionLabel>
          <ul className="space-y-2" data-testid="po-payment-history">
            {rows.map((p) => {
              const isReversal = p.reversal_of_id !== null;
              const isReversed = reversedIds.has(p.id);
              return (
                <li key={p.id} className="space-y-0.5 text-xs" data-testid={isReversal ? 'po-payment-reversal' : 'po-payment-line'}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-data tabular-nums text-text-secondary">
                      <span title={PO_DATE_HINTS.paid}>{PO_DATE_LABELS.paid} {formatPoDay(p.paid_at)}</span>
                      {' · '}<span className="uppercase">{p.method}</span>
                      {p.reference !== null && p.reference !== '' && (
                        <span className="text-text-muted"> · {p.reference}</span>
                      )}
                    </span>
                    <span className={`font-data tabular-nums ${isReversal ? 'text-danger-as-text' : isReversed ? 'text-text-muted line-through' : 'text-text-primary'}`}>
                      {formatCurrency(p.amount)}
                    </span>
                  </div>
                  {/* Le jour payé et l'instant de saisie ne se confondent plus :
                      une saisie tardive date l'écriture du jour PAYÉ (ADR-048). */}
                  <p className="font-data tabular-nums text-text-muted" title={PO_DATE_HINTS.recorded}>
                    {PO_DATE_LABELS.recorded} {formatPoInstant(p.created_at)}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {isReversal && <Badge variant="outline" className="border-danger text-danger">REVERSAL</Badge>}
                    {isReversed && <Badge variant="outline" className="border-border-strong text-text-secondary">REVERSED</Badge>}
                    {p.payment_group_id !== null && !isReversal && (
                      <Badge variant="outline" className="border-border-gold text-gold">GROUPED</Badge>
                    )}
                    {isReversal && p.reversal_reason !== null && (
                      <span className="text-text-secondary">Reason: {p.reversal_reason}</span>
                    )}
                    {isOwner && !isReversal && !isReversed && (
                      <button
                        type="button"
                        className="ml-auto inline-flex items-center gap-1 text-text-secondary underline-offset-2 hover:text-text-primary hover:underline"
                        onClick={() => setToReverse(p)}
                        data-testid="po-payment-reverse"
                      >
                        <Undo2 className="h-3 w-3" aria-hidden /> Reverse
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {canRecordPay && (
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          onClick={onRecordPayment}
          disabled={payBlockedByCancel || invoiceBlocked}
          aria-describedby="po-payment-note"
        >
          <Wallet className="h-4 w-4" aria-hidden /> Record payment
        </Button>
      )}
      <p id="po-payment-note" className="text-xs text-text-muted">
        {payBlockedByCancel
          ? 'This purchase order is cancelled — no payment can be recorded.'
          : invoiceBlocked ? INVOICE_PAYMENT_MESSAGE : 'Payment is tracked independently from goods reception.'}
      </p>

      {toReverse !== null && (
        <ReverseWithGroup poId={poId} poNumber={poNumber} payment={toReverse} onClose={() => setToReverse(null)} />
      )}
    </Card>
  );
}

/** Lit le groupe avant d'ouvrir la fenêtre : elle doit annoncer tout ce qu'elle annule. */
function ReverseWithGroup({
  poId, poNumber, payment, onClose,
}: { poId: string; poNumber: string; payment: PoPaymentRow; onClose: () => void }): JSX.Element | null {
  const group = usePaymentGroup(payment.payment_group_id);
  if (payment.payment_group_id !== null && group.data === undefined) {
    if (group.isError) {
      return <p role="alert" className="text-xs text-danger-as-text">The grouped payment could not be loaded. Try again.</p>;
    }
    return null;
  }
  const lines = group.data ?? [];
  const poIds = lines.length > 0 ? [...new Set(lines.map((l) => l.purchase_order_id))] : [poId];
  return (
    <ReversePaymentDialog
      poNumber={poNumber}
      payment={{
        id: payment.id,
        amount: payment.amount,
        method: payment.method,
        paidAt: payment.paid_at,
        groupSize: Math.max(1, lines.length),
        groupTotal: lines.length > 0 ? lines.reduce((acc, l) => acc + l.amount, 0) : payment.amount,
      }}
      poIds={poIds}
      onClose={onClose}
    />
  );
}
