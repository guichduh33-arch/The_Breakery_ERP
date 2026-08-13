// supabase/functions/_shared/pdf-templates/receipt.ts
// Lot 6c — reçu de vente en DUPLICATA (reprint), format A5 portrait.
// data = sortie de orderToReceiptPayload (@breakery/domain, IO-free) : le BO
// construit la charge côté client depuis le détail de commande et l'envoie à
// generate-pdf. L'identité boutique (nom/NPWP/adresse) vient de business_config,
// injectée par l'EF dans ctx.business (en-tête).
//
// NON-PKP (ADR-005) : la PB1 est INCLUSE dans le total ; la base s'en déduit.
import { rgb } from 'https://esm.sh/pdf-lib@1.17.1';
import { drawFooter, drawHeader, formatIDR, type LayoutContext } from '../pdf-layout.ts';

export interface ReceiptData {
  order: {
    order_number: string;
    date: string;
    order_type: string;
    cashier_name: string | null;
    customer_name: string | null;
    table_number: string | null;
  };
  items: Array<{ name: string; quantity: number; unit_price: number; line_total: number }>;
  totals: {
    base: number;
    discount: number;
    promotion_total?: number;
    tax: number;
    total: number;
  };
  payments: Array<{
    method: string;
    amount: number;
    cash_received: number | null;
    change_given: number | null;
  }>;
}

const METHOD_LABEL: Record<string, string> = {
  cash: 'Cash', card: 'Card', qris: 'QRIS', edc: 'EDC', transfer: 'Transfer',
  store_credit: 'Store credit', gopay: 'GoPay', ovo: 'OVO', dana: 'DANA',
};
const TYPE_LABEL: Record<string, string> = {
  dine_in: 'Dine in', take_out: 'Takeaway', delivery: 'Delivery', b2b: 'B2B', tablet: 'Tablet',
};

export async function render(
  ctx:     LayoutContext,
  data:    ReceiptData,
  _period: { start: string; end: string } | null,
): Promise<void> {
  // A5 portrait.
  const page = ctx.doc.addPage([420, 595]);
  const RIGHT = 380; // marge droite (width − 40)
  const orderNo = data.order.order_number.replace(/^#+/, '');
  let y = drawHeader(page, ctx, `RECEIPT #${orderNo}`);

  // Bandeau DUPLICATA — un reçu réimprimé n'est jamais l'original.
  page.drawText('DUPLICATE — reprinted copy', {
    x: 40, y, size: 9, font: ctx.fontBold, color: rgb(0.6, 0.15, 0.15),
  });
  y -= 18;

  // Adresse boutique (drawHeader ne rend que nom + NPWP).
  if (ctx.business.address) {
    page.drawText(String(ctx.business.address).slice(0, 70), {
      x: 40, y, size: 8, font: ctx.font, color: rgb(0.4, 0.4, 0.4),
    });
    y -= 14;
  }

  // ── Métadonnées commande ──
  const meta: Array<[string, string]> = [
    ['Date',     String(data.order.date).slice(0, 16).replace('T', ' ')],
    ['Type',     TYPE_LABEL[data.order.order_type] ?? data.order.order_type],
  ];
  if (data.order.table_number) meta.push(['Table', String(data.order.table_number)]);
  if (data.order.cashier_name) meta.push(['Cashier', data.order.cashier_name]);
  if (data.order.customer_name) meta.push(['Customer', data.order.customer_name]);
  for (const [l, v] of meta) {
    page.drawText(l, { x: 40, y, size: 8, font: ctx.fontBold, color: rgb(0.35, 0.35, 0.35) });
    page.drawText(String(v).slice(0, 44), { x: 110, y, size: 8, font: ctx.font, color: rgb(0.15, 0.15, 0.15) });
    y -= 12;
  }

  y -= 6;
  page.drawLine({ start: { x: 40, y }, end: { x: RIGHT, y }, thickness: 0.4, color: rgb(0.7, 0.7, 0.7) });
  y -= 14;

  // ── Tableau des lignes ──
  page.drawText('Item', { x: 40, y, size: 8, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  drawRight(page, ctx, 'Qty', 250, y, 8, true);
  drawRight(page, ctx, 'Unit', 315, y, 8, true);
  drawRight(page, ctx, 'Total', RIGHT, y, 8, true);
  y -= 4;
  page.drawLine({ start: { x: 40, y }, end: { x: RIGHT, y }, thickness: 0.3, color: rgb(0.8, 0.8, 0.8) });
  y -= 12;

  for (const it of data.items) {
    if (y < 150) {
      page.drawText('… (truncated)', { x: 40, y, size: 8, font: ctx.font, color: rgb(0.5, 0.5, 0.5) });
      y -= 12;
      break;
    }
    page.drawText(String(it.name).slice(0, 34), { x: 40, y, size: 8, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    drawRight(page, ctx, String(it.quantity), 250, y, 8, false);
    drawRight(page, ctx, formatIDR(it.unit_price), 315, y, 8, false);
    drawRight(page, ctx, formatIDR(it.line_total), RIGHT, y, 8, false);
    y -= 12;
  }

  // ── Totaux (NON-PKP : PB1 incluse) ──
  y -= 4;
  page.drawLine({ start: { x: 210, y }, end: { x: RIGHT, y }, thickness: 0.3, color: rgb(0.8, 0.8, 0.8) });
  y -= 13;
  const rows: Array<[string, string, boolean]> = [['Base (excl. PB1)', formatIDR(data.totals.base), false]];
  if (data.totals.discount > 0) rows.push(['Discount', `- ${formatIDR(data.totals.discount)}`, false]);
  if (data.totals.promotion_total && data.totals.promotion_total > 0) {
    rows.push(['Promotions', `- ${formatIDR(data.totals.promotion_total)}`, false]);
  }
  rows.push(['PB1 (included)', formatIDR(data.totals.tax), false]);
  rows.push(['Total', formatIDR(data.totals.total), true]);
  for (const [l, v, bold] of rows) {
    const f = bold ? ctx.fontBold : ctx.font;
    page.drawText(l, { x: 210, y, size: bold ? 10 : 8, font: f, color: rgb(0.2, 0.2, 0.2) });
    drawRight(page, ctx, v, RIGHT, y, bold ? 10 : 8, bold);
    y -= bold ? 15 : 12;
  }

  // ── Paiements ──
  if (data.payments.length > 0) {
    y -= 6;
    page.drawText('Payment', { x: 40, y, size: 8, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
    y -= 13;
    for (const p of data.payments) {
      const label = METHOD_LABEL[p.method] ?? p.method;
      page.drawText(label, { x: 52, y, size: 8, font: ctx.font, color: rgb(0.15, 0.15, 0.15) });
      drawRight(page, ctx, formatIDR(p.amount), RIGHT, y, 8, false);
      y -= 12;
      if (p.cash_received != null && p.change_given != null) {
        page.drawText('  Cash received', { x: 52, y, size: 7, font: ctx.font, color: rgb(0.45, 0.45, 0.45) });
        drawRight(page, ctx, formatIDR(p.cash_received), RIGHT, y, 7, false);
        y -= 10;
        page.drawText('  Change', { x: 52, y, size: 7, font: ctx.font, color: rgb(0.45, 0.45, 0.45) });
        drawRight(page, ctx, formatIDR(p.change_given), RIGHT, y, 7, false);
        y -= 10;
      }
    }
  }

  drawFooter(page, ctx, 1, 1);
}

function drawRight(
  // deno-lint-ignore no-explicit-any
  page: any,
  ctx: LayoutContext,
  text: string,
  right: number,
  y: number,
  size: number,
  bold: boolean,
): void {
  const font = bold ? ctx.fontBold : ctx.font;
  page.drawText(text, {
    x: right - font.widthOfTextAtSize(text, size),
    y,
    size,
    font,
    color: rgb(0.1, 0.1, 0.1),
  });
}
