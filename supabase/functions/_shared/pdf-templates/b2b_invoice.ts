// supabase/functions/_shared/pdf-templates/b2b_invoice.ts
// S68 — B2B commercial invoice (NON-PKP : AUCUNE ligne PB1/taxe).
// data = sortie de get_b2b_invoice_v1 (invoice / customer / lines / payment).
import { DEFAULT_INVOICE_PRINT_OPTIONS } from '../invoice-print-options.ts';
import { InvoiceCanvas } from './invoice-canvas.ts';
import type { LayoutContext } from '../pdf-layout.ts';

export interface B2bInvoiceData {
  invoice: {
    invoice_number: string | null;
    order_number:   string;
    invoice_date:   string;
    due_date:       string;
    status:         string;
    subtotal:       number;
    tax_amount:     number;
    total:          number;
    notes:          string | null;
  };
  customer: {
    company_name:       string | null;
    tax_id:             string | null;
    name:               string | null;
    phone?:             string | null;
    email?:             string | null;
    payment_terms_days: number;
  };
  lines:   Array<{ name: string; quantity: number; unit_price: number; line_total: number }>;
  payment: { amount_paid: number; outstanding: number };
}

export async function render(ctx: LayoutContext, data: B2bInvoiceData, _period: { start: string; end: string } | null): Promise<void> {
  const options = ctx.invoiceTemplate ?? DEFAULT_INVOICE_PRINT_OPTIONS;
  const canvas = new InvoiceCanvas(ctx, options, data.invoice.invoice_number ?? data.invoice.order_number);
  const money = (value: number): string => {
    if (!Number.isFinite(value)) throw new Error('invalid_invoice_amount');
    return 'Rp ' + new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(value);
  };
  const customer = ['Bill to', data.customer.company_name ?? data.customer.name ?? '—',
    data.customer.tax_id ? 'NPWP: ' + data.customer.tax_id : null, data.customer.phone, data.customer.email]
    .filter((value): value is string => typeof value === 'string' && value !== '');
  const metadata = ['Order: ' + data.invoice.order_number, 'Date: ' + String(data.invoice.invoice_date).slice(0, 10),
    ...(options.show_due_date ? ['Due: ' + String(data.invoice.due_date).slice(0, 10)] : []),
    'Status: ' + data.invoice.status];
  canvas.metadata(customer, metadata);
  canvas.tableHeader();
  for (const item of data.lines) {
    canvas.item(String(item.name), String(item.quantity), money(item.unit_price), money(item.line_total));
  }
  canvas.y -= 8;
  canvas.ensure(canvas.lineHeight * 4 + 8);
  // Les valeurs imprimées viennent de la facture et des allocations, sans recomposition.
  canvas.total('Subtotal', money(data.invoice.subtotal), false);
  canvas.total('Total', money(data.invoice.total), true);
  canvas.total('Paid', money(data.payment.amount_paid), false);
  canvas.total('Amount due', money(data.payment.outstanding), true);
  if (data.invoice.notes) { canvas.y -= 10; canvas.paragraph('Notes', true); canvas.paragraph(data.invoice.notes); }
  if (options.payment_instructions) { canvas.y -= 10; canvas.paragraph(options.payment_instructions); }
  canvas.y -= 10;
  canvas.finish();
}
