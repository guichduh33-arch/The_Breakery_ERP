// supabase/functions/_shared/pdf-templates/b2b_invoice.ts
// S68 — B2B commercial invoice (NON-PKP : AUCUNE ligne PB1/taxe).
// data = sortie de get_b2b_invoice_v1 (invoice / customer / lines / payment).
import { rgb } from 'https://esm.sh/pdf-lib@1.17.1';
import { drawFooter, drawHeader, formatIDR, type LayoutContext } from '../pdf-layout.ts';

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

export async function render(
  ctx:     LayoutContext,
  data:    B2bInvoiceData,
  _period: { start: string; end: string } | null,
): Promise<void> {
  const page = ctx.doc.addPage([595, 842]);
  const title = data.invoice.invoice_number ?? data.invoice.order_number;
  let y = drawHeader(page, ctx, `INVOICE ${title}`);

  // Business address sous l'en-tête (drawHeader ne rend que nom + NPWP).
  if (ctx.business.address) {
    page.drawText(String(ctx.business.address).slice(0, 90), {
      x: 40, y, size: 8, font: ctx.font, color: rgb(0.4, 0.4, 0.4),
    });
    y -= 16;
  }

  // ── Métadonnées facture (droite) + Bill To (gauche) ──
  const metaX = 360;
  const meta: Array<[string, string]> = [
    ['Invoice no', data.invoice.invoice_number ?? '—'],
    ['Order no',   data.invoice.order_number],
    ['Date',       String(data.invoice.invoice_date).slice(0, 10)],
    ['Due date',   String(data.invoice.due_date).slice(0, 10)],
    ['Status',     data.invoice.status],
  ];
  let my = y;
  for (const [l, v] of meta) {
    page.drawText(l, { x: metaX, y: my, size: 9, font: ctx.fontBold, color: rgb(0.3, 0.3, 0.3) });
    page.drawText(v, { x: 555 - ctx.font.widthOfTextAtSize(v, 9), y: my, size: 9, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    my -= 13;
  }

  page.drawText('Bill To', { x: 40, y, size: 11, font: ctx.fontBold, color: rgb(0.1, 0.1, 0.1) });
  let by = y - 16;
  const billLines = [
    data.customer.company_name ?? data.customer.name ?? '—',
    data.customer.tax_id ? `NPWP: ${data.customer.tax_id}` : null,
    data.customer.phone ?? null,
    data.customer.email ?? null,
  ].filter((s): s is string => s !== null && s !== '');
  for (const l of billLines) {
    page.drawText(l.slice(0, 60), { x: 52, y: by, size: 9, font: ctx.font, color: rgb(0.2, 0.2, 0.2) });
    by -= 13;
  }

  y = Math.min(by, my) - 14;

  // ── Tableau des lignes ──
  page.drawText('Item',  { x: 52,  y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Qty',   { x: 320, y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Unit',  { x: 400, y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Total', { x: 500, y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  y -= 4;
  page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 0.3, color: rgb(0.7, 0.7, 0.7) });
  y -= 12;

  for (const it of data.lines) {
    if (y < 90) {
      drawFooter(page, ctx, 1, 1);
      // Une facture B2B tient normalement sur une page ; garde défensive : stop au débordement.
      break;
    }
    page.drawText(String(it.name).slice(0, 40), { x: 52, y, size: 9, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    const q = String(it.quantity);
    page.drawText(q, { x: 360 - ctx.font.widthOfTextAtSize(q, 9), y, size: 9, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    const u = formatIDR(it.unit_price);
    page.drawText(u, { x: 460 - ctx.font.widthOfTextAtSize(u, 9), y, size: 9, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    const t = formatIDR(it.line_total);
    page.drawText(t, { x: 555 - ctx.font.widthOfTextAtSize(t, 9), y, size: 9, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    y -= 13;
  }

  // ── Totaux (AUCUNE ligne taxe/PB1 — B2B NON-PKP) ──
  y -= 6;
  page.drawLine({ start: { x: 320, y }, end: { x: 555, y }, thickness: 0.3, color: rgb(0.7, 0.7, 0.7) });
  y -= 14;
  const totals: Array<[string, string]> = [
    ['Subtotal',   formatIDR(data.invoice.subtotal)],
    ['Total',      formatIDR(data.invoice.total)],
    ['Paid',       formatIDR(data.payment.amount_paid)],
    ['Amount due', formatIDR(data.payment.outstanding)],
  ];
  for (const [l, v] of totals) {
    const bold = l === 'Total' || l === 'Amount due';
    const f = bold ? ctx.fontBold : ctx.font;
    page.drawText(l, { x: 400, y, size: 9, font: f, color: rgb(0.2, 0.2, 0.2) });
    page.drawText(v, { x: 555 - f.widthOfTextAtSize(v, 9), y, size: 9, font: f, color: rgb(0.1, 0.1, 0.1) });
    y -= 13;
  }

  if (data.invoice.notes) {
    y -= 12;
    page.drawText('Notes', { x: 40, y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
    y -= 13;
    page.drawText(String(data.invoice.notes).slice(0, 100), { x: 52, y, size: 8, font: ctx.font, color: rgb(0.3, 0.3, 0.3) });
  }

  drawFooter(page, ctx, 1, 1);
}
