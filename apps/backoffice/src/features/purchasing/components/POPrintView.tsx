// apps/backoffice/src/features/purchasing/components/POPrintView.tsx
//
// Session 13 — Phase 3.A — minimal print-friendly PO view. Use
// window.print() from the wrapper page; the @media print rules in
// the global stylesheet hide chrome.

import type { JSX } from 'react';
import type { PurchaseOrderDetail } from '../hooks/usePurchaseOrderDetail.js';

export interface POPrintViewProps {
  po: PurchaseOrderDetail;
}

function fmt(amount: number | string | null): string {
  return Number(amount ?? 0).toLocaleString('id-ID', { maximumFractionDigits: 2 });
}

export function POPrintView({ po }: POPrintViewProps): JSX.Element {
  return (
    <article className="bg-white text-black p-6 print:p-0 max-w-3xl mx-auto">
      <header className="flex justify-between border-b pb-4 mb-4">
        <div>
          <h1 className="text-2xl font-serif">PURCHASE ORDER</h1>
          <p className="text-sm mt-1">#{po.po_number}</p>
        </div>
        <div className="text-right text-sm">
          <div><strong>Order date:</strong> {po.order_date ?? '—'}</div>
          <div><strong>Expected:</strong>   {po.expected_date ?? '—'}</div>
          <div><strong>Terms:</strong>      {po.payment_terms === 'cash' ? 'Cash' : 'Credit'}</div>
        </div>
      </header>
      <section className="mb-4 text-sm">
        <h2 className="font-semibold text-base mb-1">Supplier</h2>
        <div>{po.suppliers?.name ?? '?'}{' '}<span className="text-gray-500">({po.suppliers?.code ?? '—'})</span></div>
      </section>
      <table className="w-full text-sm border-collapse mb-4">
        <thead>
          <tr className="border-b">
            <th className="text-left py-1">Product</th>
            <th className="text-right py-1 w-20">Qty</th>
            <th className="text-left py-1 w-16">Unit</th>
            <th className="text-right py-1 w-24">Unit cost</th>
            <th className="text-right py-1 w-28">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          {po.purchase_order_items.map((it) => (
            <tr key={it.id} className="border-b">
              <td className="py-1">{it.products?.name ?? '?'}{' '}<span className="text-gray-500">({it.products?.sku ?? '—'})</span></td>
              <td className="py-1 text-right tabular-nums">{fmt(it.quantity)}</td>
              <td className="py-1">{it.unit}</td>
              <td className="py-1 text-right tabular-nums">{fmt(it.unit_cost)}</td>
              <td className="py-1 text-right tabular-nums">{fmt(it.subtotal)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="text-sm">
          <tr><td colSpan={4} className="text-right pt-2">Subtotal</td><td className="text-right pt-2 tabular-nums">{fmt(po.subtotal)}</td></tr>
          <tr><td colSpan={4} className="text-right">VAT</td><td className="text-right tabular-nums">{fmt(po.vat_amount)}</td></tr>
          <tr><td colSpan={4} className="text-right font-semibold">Total</td><td className="text-right font-semibold tabular-nums">{fmt(po.total_amount)}</td></tr>
        </tfoot>
      </table>
      {po.notes !== null && po.notes !== '' && (
        <section className="text-sm mt-4 border-t pt-3">
          <h3 className="font-semibold mb-1">Notes</h3>
          <p>{po.notes}</p>
        </section>
      )}
    </article>
  );
}
