import type { JSX } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/BackofficeUi.js";
import { SectionLabel } from "@/components/SectionLabel.js";
import { formatCurrency, formatQuantity } from "@breakery/utils";
import type { PurchaseOrderDetail } from "../hooks/usePurchaseOrderDetail.js";
import { formatPoDay } from "../poVocabulary.js";
import { FOCUS_RING } from "@/components/focusRing.js";
import { GoodsReceiptNotesCard } from "./GoodsReceiptNotesCard.js";

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
// Délègue au vocabulaire commun des achats (année affichée hors année courante).
export function fmtDay(d: string | null | undefined): string {
  return formatPoDay(d);
}

// Quantités commandées / reçues. L'unité occupe sa PROPRE colonne dans la
// table des lignes : `formatQuantity` la reçoit donc à `null`, sinon chaque
// ligne l'écrirait deux fois. Le `?? 0` est conservé — une ligne sans réception
// vaut zéro reçu, ce n'est pas une valeur inconnue.
function fmtQty(quantity: number | string | null): string {
  return formatQuantity(quantity ?? 0, null);
}

export function PurchaseOrderContent({
  po, canCancelReceipt = false,
}: { po: PurchaseOrderDetail; canCancelReceipt?: boolean }): JSX.Element {
  return <>
          <Card variant="default" padding="md" className="space-y-4">
            <SectionLabel as="h2" size="sm" className="text-gold">Order Information</SectionLabel>
            {/* Les dates du bon vivent dans la carte « Key dates » : ici, elles
                se répétaient sous trois noms différents de ceux de la liste. */}
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-md bg-surface-inert px-3 py-2">
                <dt className="text-sm font-medium text-text-secondary">Supplier</dt>
                <dd className="mt-0.5 text-sm">
                  <Link to={`/backoffice/suppliers/${po.supplier_id}`} className={`text-gold hover:underline ${FOCUS_RING}`}>
                    {po.suppliers?.name ?? '—'}
                  </Link>
                </dd>
              </div>
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
                      <td className={`${NUM_CELL} font-medium`}>
                        {fmtIdr(Number(it.subtotal ?? 0) - Number(it.discount_amount ?? 0))}
                        {Number(it.discount_amount ?? 0) > 0 && (
                          <span className="block text-xs font-normal text-text-secondary">
                            after {fmtIdr(it.discount_amount)} discount
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <GoodsReceiptNotesCard po={po} canCancelReceipt={canCancelReceipt} />

          {po.notes !== null && po.notes !== '' && (
            <Card variant="default" padding="md" className="space-y-2">
              <SectionLabel as="h2" size="sm" className="text-gold">Notes</SectionLabel>
              <p className="text-sm text-text-secondary whitespace-pre-wrap">{po.notes}</p>
            </Card>
          )}
  </>;
}

// La pastille de paiement vit dans `PoPaymentBadge.tsx`, partagée avec la fiche
// fournisseur ; ré-exportée ici pour les appelants existants.
export { PaymentStatusBadge } from "./PoPaymentBadge.js";

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
