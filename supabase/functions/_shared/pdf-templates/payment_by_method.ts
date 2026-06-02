// supabase/functions/_shared/pdf-templates/payment_by_method.ts
// S30 Wave 3.1 — Payment by Method PDF template
import { rgb } from 'https://esm.sh/pdf-lib@1.17.1';
import { drawFooter, drawHeader, formatIDR, type LayoutContext } from '../pdf-layout.ts';

export interface PaymentsByMethodData {
  period: { start: string; end: string };
  summary: {
    total_amount: number;
    total_count:  number;
    total_orders: number;
  };
  by_method: Array<{
    method:    string;
    amount:    number;
    count:     number;
    share_pct: number;
  }>;
  by_day: Array<{
    day:          string;
    cash:         number;
    card:         number;
    qris:         number;
    edc:          number;
    transfer:     number;
    store_credit: number;
    other?:       number; // M9(b) — catch-all for any tender outside the 6 named methods
    total:        number;
  }>;
}

export async function render(
  ctx:    LayoutContext,
  data:   PaymentsByMethodData,
  period: { start: string; end: string } | null,
): Promise<void> {
  let page = ctx.doc.addPage([595, 842]);
  let y = drawHeader(page, ctx, 'Payment by Method', period ?? data.period);

  // ── Summary ──────────────────────────────────────────────────────────────────
  page.drawText('Summary', { x: 40, y, size: 11, font: ctx.fontBold, color: rgb(0.1, 0.1, 0.1) });
  y -= 18;
  const sumRows: Array<[string, string]> = [
    ['Total amount',  formatIDR(data.summary.total_amount)],
    ['Payment count', String(data.summary.total_count)],
    ['Order count',   String(data.summary.total_orders)],
  ];
  for (const [l, v] of sumRows) {
    page.drawText(l, { x: 52, y, size: 9, font: ctx.font, color: rgb(0.2, 0.2, 0.2) });
    page.drawText(v, { x: 555 - ctx.font.widthOfTextAtSize(v, 9), y, size: 9, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    y -= 13;
  }
  y -= 8;

  // ── By method table ──────────────────────────────────────────────────────────
  page.drawText('By method', { x: 40, y, size: 11, font: ctx.fontBold, color: rgb(0.1, 0.1, 0.1) });
  y -= 16;
  page.drawText('Method', { x: 52,  y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Amount', { x: 280, y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Count',  { x: 400, y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Share',  { x: 490, y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  y -= 4;
  page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 0.3, color: rgb(0.7, 0.7, 0.7) });
  y -= 12;

  let rowIndex = 0;
  for (const r of data.by_method) {
    const bg = rowIndex % 2 === 0 ? rgb(0.97, 0.97, 0.97) : rgb(1, 1, 1);
    page.drawRectangle({ x: 40, y: y - 2, width: 515, height: 13, color: bg });
    page.drawText(r.method, { x: 52, y, size: 9, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    const a = formatIDR(r.amount);
    page.drawText(a, { x: 385 - ctx.font.widthOfTextAtSize(a, 9), y, size: 9, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    const c = String(r.count);
    page.drawText(c, { x: 445 - ctx.font.widthOfTextAtSize(c, 9), y, size: 9, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    const s = `${r.share_pct.toFixed(2)}%`;
    page.drawText(s, { x: 555 - ctx.font.widthOfTextAtSize(s, 9), y, size: 9, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    y -= 13;
    rowIndex++;
  }
  y -= 10;

  // ── By day table ─────────────────────────────────────────────────────────────
  page.drawText('By day', { x: 40, y, size: 11, font: ctx.fontBold, color: rgb(0.1, 0.1, 0.1) });
  y -= 16;
  page.drawText('Date',  { x: 40,  y, size: 8, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Cash',  { x: 130, y, size: 8, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Card',  { x: 200, y, size: 8, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('QRIS',  { x: 270, y, size: 8, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('EDC',   { x: 340, y, size: 8, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Other', { x: 410, y, size: 8, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Total', { x: 490, y, size: 8, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  y -= 4;
  page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 0.3, color: rgb(0.7, 0.7, 0.7) });
  y -= 12;

  rowIndex = 0;
  for (const d of data.by_day) {
    if (y < 80) {
      drawFooter(page, ctx, 1, 1);
      page = ctx.doc.addPage([595, 842]);
      y = drawHeader(page, ctx, 'Payment by Method — By day (cont.)', data.period);
      rowIndex = 0;
    }
    const bg = rowIndex % 2 === 0 ? rgb(0.97, 0.97, 0.97) : rgb(1, 1, 1);
    page.drawRectangle({ x: 40, y: y - 2, width: 515, height: 11, color: bg });
    page.drawText(String(d.day).slice(0, 10), { x: 40, y, size: 8, font: ctx.font, color: rgb(0.3, 0.3, 0.3) });

    const cells: Array<[number, number]> = [
      [d.cash,                        195],
      [d.card,                        265],
      [d.qris,                        335],
      [d.edc,                         405],
      [d.transfer + d.store_credit + (d.other ?? 0),   475],
      [d.total,                       555],
    ];
    for (const [val, xRight] of cells) {
      const t = formatIDR(val);
      page.drawText(t, { x: xRight - ctx.font.widthOfTextAtSize(t, 8), y, size: 8, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    }
    y -= 11;
    rowIndex++;
  }

  drawFooter(page, ctx, 1, 1);
}
