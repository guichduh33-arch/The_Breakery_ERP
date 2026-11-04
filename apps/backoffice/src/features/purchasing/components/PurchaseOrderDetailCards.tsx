import type { JSX } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { Badge } from "@breakery/ui";
import { Card, EmptyState } from "@/components/BackofficeUi.js";
import { SectionLabel } from "@/components/SectionLabel.js";
import { formatCurrency, formatDateShortWita, formatQuantity } from "@breakery/utils";
import type { PurchaseOrderDetail } from "../hooks/usePurchaseOrderDetail.js";
import type { PoPaymentStatus } from "../hooks/usePoPayments.js";

/** Cellule numérique : mono tabulaire alignée à droite (The Mono-Carries-Data
 *  Rule). `tabular-nums` seul ne suffit pas — sans `font-data`, le chiffre sort
 *  dans la sans-serif de l'interface. */
const NUM_CELL = 'px-3 py-2 text-right font-data tabular-nums';

export function fmtIdr(amount: number | string | null): string {
  return formatCurrency(Number(amount ?? 0));
}

// Un jour du bon de commande (commande, livraison prévue, réception, jalon) —
// la colonne ISO brute (`2026-09-05`) était la huitième forme de date que
// `dates.ts` déclare de trop. Absent = tiret, comme les montants.
export function fmtDay(d: string | null | undefined): string {
  return d === null || d === undefined || d === '' ? '—' : formatDateShortWita(d);
}

// Quantités commandées / reçues. L'unité occupe sa PROPRE colonne dans la
// table des lignes : `formatQuantity` la reçoit donc à `null`, sinon chaque
// ligne l'écrirait deux fois. Le `?? 0` est conservé — une ligne sans réception
// vaut zéro reçu, ce n'est pas une valeur inconnue.
function fmtQty(quantity: number | string | null): string {
  return formatQuantity(quantity ?? 0, null);
}

export function PurchaseOrderContent({ po }: { po: PurchaseOrderDetail }): JSX.Element {
  return <>
          <Card variant="default" padding="md" className="space-y-4">
            <SectionLabel as="h2" size="sm" className="text-gold">Order Information</SectionLabel>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Supplier"          value={po.suppliers?.name ?? '—'} mono />
              <Field label="Order date"        value={fmtDay(po.order_date)} />
              <Field label="Expected delivery" value={fmtDay(po.expected_date)} />
              <Field label="Actual delivery"   value={fmtDay(po.received_date)} />
              <Field label="Payment terms"     value={po.payment_terms === 'cash' ? 'Cash on delivery' : 'Credit'} />
              {po.cancel_reason !== null && po.cancel_reason !== '' && (
                <Field label="Cancel reason"   value={po.cancel_reason} />
              )}
            </dl>
          </Card>

          <Card variant="default" padding="md" className="space-y-3">
            <SectionLabel as="h2" size="sm" id="po-ordered-items-heading" className="text-gold">Ordered Items</SectionLabel>
            <div className="overflow-x-auto rounded-md border border-border-subtle">
              <table className="w-full text-sm" aria-labelledby="po-ordered-items-heading">
                <thead className="bg-surface-inert">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left">
                      <SectionLabel as="span" size="xs">Product</SectionLabel>
                    </th>
                    <th scope="col" className="px-3 py-2 text-right w-24">
                      <SectionLabel as="span" size="xs">Quantity</SectionLabel>
                    </th>
                    <th scope="col" className="px-3 py-2 text-right w-24">
                      <SectionLabel as="span" size="xs">Received</SectionLabel>
                    </th>
                    <th scope="col" className="px-3 py-2 text-left w-20">
                      <SectionLabel as="span" size="xs">Unit</SectionLabel>
                    </th>
                    <th scope="col" className="px-3 py-2 text-right w-28">
                      <SectionLabel as="span" size="xs">Unit price</SectionLabel>
                    </th>
                    <th scope="col" className="px-3 py-2 text-right w-32">
                      <SectionLabel as="span" size="xs">Subtotal</SectionLabel>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {po.purchase_order_items.map((it) => (
                    <tr key={it.id} className="border-t border-border-subtle">
                      <td className="px-3 py-2">
                        <span className="text-text-primary">{it.products?.name ?? '?'}</span>{' '}
                        <span className="text-text-secondary text-xs">({it.products?.sku ?? '—'})</span>
                      </td>
                      <td className={NUM_CELL}>{fmtQty(it.quantity)}</td>
                      <td className={NUM_CELL}>{fmtQty(it.received_quantity)}</td>
                      <td className="px-3 py-2 text-text-secondary">{it.unit}</td>
                      <td className={NUM_CELL}>{fmtIdr(it.unit_cost)}</td>
                      <td className={`${NUM_CELL} font-medium`}>{fmtIdr(it.subtotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card variant="default" padding="md" className="space-y-3">
            <SectionLabel as="h2" size="sm" id="po-grn-heading" className="text-gold">Goods Receipt Notes</SectionLabel>
            {po.goods_receipt_notes.length === 0 ? (
              <EmptyState
                title="No receipts recorded yet"
                description="The first GRN will appear here once goods have been received."
                size="sm"
              />
            ) : (
              <div className="overflow-x-auto rounded-md border border-border-subtle">
                <table className="w-full text-sm" aria-labelledby="po-grn-heading">
                  <thead className="bg-surface-inert">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-left">
                        <SectionLabel as="span" size="xs">GRN</SectionLabel>
                      </th>
                      <th scope="col" className="px-3 py-2 text-left w-32">
                        <SectionLabel as="span" size="xs">Date</SectionLabel>
                      </th>
                      <th scope="col" className="px-3 py-2 text-right w-32">
                        <SectionLabel as="span" size="xs">Subtotal</SectionLabel>
                      </th>
                      <th scope="col" className="px-3 py-2 text-right w-32">
                        <SectionLabel as="span" size="xs">VAT</SectionLabel>
                      </th>
                      <th scope="col" className="px-3 py-2 text-right w-32">
                        <SectionLabel as="span" size="xs">Total</SectionLabel>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {po.goods_receipt_notes.map((g) => (
                      <tr key={g.id} className="border-t border-border-subtle">
                        <td className="px-3 py-2 font-mono text-xs">{g.grn_number}</td>
                        <td className="px-3 py-2 font-data tabular-nums text-text-secondary">{formatDateShortWita(g.received_date)}</td>
                        <td className={NUM_CELL}>{fmtIdr(g.subtotal)}</td>
                        <td className={NUM_CELL}>{fmtIdr(g.vat_amount)}</td>
                        <td className={`${NUM_CELL} font-medium`}>{fmtIdr(g.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {po.notes !== null && po.notes !== '' && (
            <Card variant="default" padding="md" className="space-y-2">
              <SectionLabel as="h2" size="sm" className="text-gold">Notes</SectionLabel>
              <p className="text-sm text-text-secondary whitespace-pre-wrap">{po.notes}</p>
            </Card>
          )}
  </>;
}

export function PaymentStatusBadge({ status }: { status: PoPaymentStatus }): JSX.Element {
  if (status === 'paid') {
    return <Badge variant="outline" className="border-success text-success">PAID</Badge>;
  }
  if (status === 'partial') {
    return <Badge variant="outline" className="border-border-gold text-gold">PARTIAL</Badge>;
  }
  return <Badge variant="outline" className="border-danger text-danger">UNPAID</Badge>;
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }): JSX.Element {
  return (
    <div className="rounded-md bg-surface-inert px-3 py-2">
      <dt className="text-sm font-medium text-text-secondary">{label}</dt>
      <dd className={`mt-0.5 text-sm text-text-primary ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}

export function SummaryRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 text-text-secondary">
      <dt>{label}</dt>
      <dd className="font-data tabular-nums text-text-primary">{value}</dd>
    </div>
  );
}

export function TimelineItem({
  reached,
  cancelled = false,
  label,
  date,
}: {
  reached: boolean;
  cancelled?: boolean;
  label: string;
  date: string;
}): JSX.Element {
  return (
    <li className="flex items-center gap-2">
      {cancelled ? (
        <XCircle className="h-3.5 w-3.5 text-danger" aria-hidden />
      ) : (
        <CheckCircle2
          className={`h-3.5 w-3.5 ${reached ? 'text-success' : 'text-text-muted'}`}
          aria-hidden
        />
      )}
      <span className={reached ? 'text-text-primary' : 'text-text-muted'}>{label}</span>
      <span className="ml-auto text-text-muted tabular-nums">{date}</span>
    </li>
  );
}
