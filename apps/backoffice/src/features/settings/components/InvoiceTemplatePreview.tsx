import { useEffect, useRef, useState } from 'react';
import { formatCurrency } from '@breakery/utils';
import type { InvoiceTemplateSettings } from '../invoiceTemplate.js';

export interface InvoicePreviewBusiness { name: string; contact: string; logoUrl?: string; taxId?: string }

export function InvoiceTemplatePreview({ value, business }: { value: InvoiceTemplateSettings; business: InvoicePreviewBusiness }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(() => { setWidth(element.getBoundingClientRect().width); });
    observer.observe(element);
    return () => { observer.disconnect(); };
  }, []);
  const scale = width / (value.paper_width_mm * 72 / 25.4);
  const fontSize = (value.density === 'compact' ? 8 : 9) * scale;
  return <section aria-label="Invoice preview" className="min-w-0 rounded-md border border-border-subtle bg-bg-elevated">
    <div className="flex flex-wrap justify-between gap-2 border-b border-border-subtle px-5 py-3 text-xs">
      <h2 className="font-semibold">Invoice preview</h2><span className="text-text-muted">{value.paper_width_mm} × {value.paper_height_mm} mm · Example data</span>
    </div>
    <div className="bg-surface-4 p-6">
      <div ref={ref} data-testid="invoice-paper-preview" className="relative mx-auto w-full max-w-3xl bg-bg-elevated text-text-primary"
        style={{ aspectRatio: `${value.paper_width_mm} / ${value.paper_height_mm}`, fontSize, lineHeight: 1.45 }}>
        <div className="absolute flex flex-col" style={{
          left: `${100 * (value.margin_left_mm + value.offset_x_mm) / value.paper_width_mm}%`,
          top: `${100 * (value.margin_top_mm + value.offset_y_mm) / value.paper_height_mm}%`,
          width: `${100 * (value.paper_width_mm - value.margin_left_mm - value.margin_right_mm) / value.paper_width_mm}%`,
          height: `${100 * (value.paper_height_mm - value.margin_top_mm - value.margin_bottom_mm) / value.paper_height_mm}%`,
        }}>
          <div className="flex justify-between gap-4 border-b border-border-subtle pb-3">
            <div className="min-w-0">
              {value.show_logo && business.logoUrl && <img src={business.logoUrl} alt="Business logo" className="mb-2 h-8 max-w-28 object-contain" />}
              <strong>{value.business_name || business.name}</strong>
              {value.show_contact && <p className="mt-1 whitespace-pre-line text-text-secondary">{value.contact_text || business.contact}</p>}
              {business.taxId && <p className="mt-1 text-text-secondary">NPWP: {business.taxId}</p>}
            </div>
            <div className="min-w-0 text-right"><strong className="break-words" style={{ fontSize: fontSize * 1.8 }}>{value.heading}</strong><p className="font-mono">INV-SAMPLE-001</p></div>
          </div>
          <div className="my-4 grid grid-cols-2 gap-3">
            <div><p className="mb-1 text-text-muted">Bill to</p><strong>Example customer</strong><p>Example company</p></div>
            <div className="text-right"><p>Order: B2B-SAMPLE-001</p><p>Date: 06 Nov 2026</p>{value.show_due_date && <p>Due: 20 Nov 2026</p>}<p>Status: Unpaid</p></div>
          </div>
          <table className="w-full border-collapse" style={{ fontSize: 'inherit' }}>
            <thead><tr className="border-b border-border-strong"><th className="pb-2 text-left font-medium">Item</th><th className="pb-2 text-right font-medium">Qty</th>{value.show_unit_prices && <th className="pb-2 text-right font-medium">Unit price</th>}<th className="pb-2 text-right font-medium">Total</th></tr></thead>
            <tbody>{[{ name: 'Croissant', qty: 12, price: 10000, total: 120000 }, { name: 'Mini chocolatine', qty: 30, price: 5000, total: 150000 }].map((item) => <tr key={item.name} className="border-b border-border-subtle">
              <td className="py-2">{item.name}</td><td className="py-2 text-right">{item.qty}</td>{value.show_unit_prices && <td className="py-2 text-right">{formatCurrency(item.price)}</td>}<td className="py-2 text-right">{formatCurrency(item.total)}</td>
            </tr>)}</tbody>
          </table>
          <dl className="ml-auto mt-4 grid w-1/2 grid-cols-2 gap-x-3 gap-y-1">
            <dt>Subtotal</dt><dd className="text-right font-mono">{formatCurrency(270000)}</dd><dt>Total</dt><dd className="text-right font-mono">{formatCurrency(270000)}</dd><dt>Paid</dt><dd className="text-right font-mono">{formatCurrency(0)}</dd><dt className="mt-1 border-t border-border-subtle pt-1 font-semibold">Amount due</dt><dd className="mt-1 border-t border-border-subtle pt-1 text-right font-mono font-semibold">{formatCurrency(270000)}</dd>
          </dl>
          <p className="mt-4 whitespace-pre-line">{value.payment_instructions}</p>
          <p className="mt-auto whitespace-pre-line pt-3 text-center text-text-secondary">{value.footer_message}</p>
          <p className="mt-2 flex justify-between text-text-muted"><span>Sample · Not an issued invoice</span><span>Page 1 / 1</span></p>
        </div>
      </div>
    </div>
    <p className="px-5 py-3 text-xs text-text-muted">Visual preview using example data. Check final placement on the generated PDF. Long invoices continue on additional pages. Prices, quantities and payment balances come from the order.</p>
  </section>;
}
