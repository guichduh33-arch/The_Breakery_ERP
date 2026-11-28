// Carte « Key dates » de la fiche d'un bon de commande.
//
// Elle remplace la « Status Timeline », qui nommait des étapes inexistantes
// (« Confirmed / Sent » : le cycle réel n'a ni `sent` ni `confirmed`), datait
// « Receiving » de la livraison PRÉVUE faute de réception, et ne disait rien du
// paiement. Ici, chaque date garde le nom du vocabulaire commun (`poVocabulary`)
// et une phrase qui dit ce qu'elle mesure. Le paiement a DEUX dates : le jour
// réel du décaissement (il date l'écriture) et l'instant de la saisie.

import type { JSX } from 'react';
import { Card } from '@/components/BackofficeUi.js';
import { SectionLabel } from '@/components/SectionLabel.js';
import type { PurchaseOrderDetail } from '../hooks/usePurchaseOrderDetail.js';
import type { PoPaymentRow, PoPaymentStatus } from '../hooks/usePoPayments.js';
import { PO_DATE_HINTS, PO_DATE_LABELS, formatPoDay, formatPoInstant } from '../poVocabulary.js';

interface Props {
  po:            PurchaseOrderDetail;
  payments:      readonly PoPaymentRow[] | undefined;
  paymentStatus: PoPaymentStatus;
}

interface DateRow {
  key:   string;
  label: string;
  value: string;
  hint:  string;
  tone?: 'danger' | 'muted';
}

/** Les paiements qui comptent encore : ni contre-passés, ni contre-passations. */
function livePayments(payments: readonly PoPaymentRow[]): PoPaymentRow[] {
  const reversed = new Set(payments.flatMap((p) => (p.reversal_of_id !== null ? [p.reversal_of_id] : [])));
  return payments.filter((p) => p.reversal_of_id === null && !reversed.has(p.id));
}

export function buildKeyDates({ po, payments, paymentStatus }: Props): DateRow[] {
  const receipts = (po.goods_receipt_notes ?? []).filter((g) => g.cancelled_at === null);
  const firstReceipt = receipts.map((g) => g.received_date).sort()[0] ?? null;
  const live = livePayments(payments ?? []);
  const lastPaid = live.map((p) => p.paid_at).sort().at(-1) ?? null;
  const lastRecorded = live.map((p) => p.created_at).sort().at(-1) ?? null;

  const rows: DateRow[] = [
    { key: 'created',  label: PO_DATE_LABELS.created,  value: formatPoInstant(po.created_at),  hint: PO_DATE_HINTS.created },
    { key: 'ordered',  label: PO_DATE_LABELS.ordered,  value: formatPoDay(po.order_date),      hint: PO_DATE_HINTS.ordered },
    { key: 'expected', label: PO_DATE_LABELS.expected, value: formatPoDay(po.expected_date),   hint: PO_DATE_HINTS.expected },
  ];

  // Réception : la première, puis celle qui a soldé le bon si elle diffère.
  if (po.status === 'received' && po.received_date !== null && po.received_date !== firstReceipt) {
    rows.push({ key: 'first-received', label: 'First receipt', value: formatPoDay(firstReceipt), hint: PO_DATE_HINTS.received });
    rows.push({ key: 'received', label: 'Fully received', value: formatPoDay(po.received_date), hint: PO_DATE_HINTS.received });
  } else if (po.status === 'received') {
    rows.push({ key: 'received', label: 'Fully received', value: formatPoDay(po.received_date ?? firstReceipt), hint: PO_DATE_HINTS.received });
  } else {
    rows.push({
      key: 'received',
      label: po.status === 'partial' ? 'First receipt' : PO_DATE_LABELS.received,
      value: firstReceipt !== null ? formatPoDay(firstReceipt) : 'Not yet',
      hint: PO_DATE_HINTS.received,
      ...(firstReceipt === null ? { tone: 'muted' as const } : {}),
    });
  }

  if (po.status !== 'cancelled') {
    rows.push({
      key: 'paid',
      label: paymentStatus === 'paid' ? 'Paid in full on' : 'Last paid on',
      value: lastPaid !== null ? formatPoDay(lastPaid) : 'Not yet',
      hint: PO_DATE_HINTS.paid,
      ...(lastPaid === null ? { tone: 'muted' as const } : {}),
    });
    if (lastRecorded !== null) {
      rows.push({ key: 'recorded', label: 'Payment recorded', value: formatPoInstant(lastRecorded), hint: PO_DATE_HINTS.recorded });
    }
  } else {
    rows.push({ key: 'cancelled', label: 'Cancelled', value: formatPoInstant(po.cancelled_at), hint: 'When the order was cancelled.', tone: 'danger' });
  }
  return rows;
}

export function PoKeyDatesCard(props: Props): JSX.Element {
  const rows = buildKeyDates(props);
  return (
    <Card variant="default" padding="md" className="space-y-3" data-testid="po-key-dates">
      <SectionLabel as="h2" size="sm" className="text-gold">Key dates</SectionLabel>
      <dl className="space-y-2 text-sm">
        {rows.map((r) => (
          <div key={r.key} className="flex flex-wrap items-baseline justify-between gap-x-3">
            <dt className="text-text-secondary">
              {r.label}
              <span className="block text-xs text-text-muted">{r.hint}</span>
            </dt>
            <dd className={`font-data tabular-nums ${r.tone === 'danger' ? 'text-danger-as-text' : r.tone === 'muted' ? 'text-text-muted' : 'text-text-primary'}`}>
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
