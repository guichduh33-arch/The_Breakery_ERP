// supabase/functions/_shared/pdf-templates/pb1.ts
// S30 Wave 3.1 — VAT / PB1 Report PDF template (NON-PKP: PB1 10% only)
import { rgb } from 'https://esm.sh/pdf-lib@1.17.1';
import { drawFooter, drawHeader, formatIDR, formatPct, type LayoutContext } from '../pdf-layout.ts';

export interface Pb1Data {
  period: {
    month: number;
    year:  number;
    start: string;
    end:   string;
  };
  pb1_rate:              number; // e.g. 0.10
  taxable_base:          number;
  pb1_collected:         number;
  pb1_payable:           number;
  by_day:                Array<{ day: string; taxable_base: number; pb1_collected: number }>;
  balance_account_code:  string;
  balance_at_period_end: number;
}

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export async function render(
  ctx:     LayoutContext,
  data:    Pb1Data,
  _period: { start: string; end: string } | null,
): Promise<void> {
  let page = ctx.doc.addPage([595, 842]);
  const titlePeriod = { start: data.period.start, end: data.period.end };
  let y = drawHeader(page, ctx, `PB1 Report — ${MONTHS[data.period.month]} ${data.period.year}`, titlePeriod);

  // ── Summary ──────────────────────────────────────────────────────────────────
  page.drawText('Summary', { x: 40, y, size: 11, font: ctx.fontBold, color: rgb(0.1, 0.1, 0.1) });
  y -= 18;
  const sumRows: Array<[string, string]> = [
    ['PB1 rate',                               formatPct(data.pb1_rate)],
    ['Taxable base',                            formatIDR(data.taxable_base)],
    ['PB1 collected',                           formatIDR(data.pb1_collected)],
    ['PB1 payable',                             formatIDR(data.pb1_payable)],
    [`Balance ${data.balance_account_code} at period end`, formatIDR(data.balance_at_period_end)],
  ];
  for (const [l, v] of sumRows) {
    page.drawText(l, { x: 52, y, size: 9, font: ctx.font, color: rgb(0.2, 0.2, 0.2) });
    page.drawText(v, { x: 555 - ctx.font.widthOfTextAtSize(v, 9), y, size: 9, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    y -= 13;
  }
  y -= 10;

  // ── By day table ─────────────────────────────────────────────────────────────
  page.drawText('By day', { x: 40, y, size: 11, font: ctx.fontBold, color: rgb(0.1, 0.1, 0.1) });
  y -= 16;
  page.drawText('Date',          { x: 52,  y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Taxable base',  { x: 300, y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('PB1 collected', { x: 455, y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  y -= 4;
  page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 0.3, color: rgb(0.7, 0.7, 0.7) });
  y -= 12;

  let rowIndex = 0;
  for (const d of data.by_day) {
    if (y < 80) {
      drawFooter(page, ctx, 1, 1);
      page = ctx.doc.addPage([595, 842]);
      y = drawHeader(page, ctx, 'PB1 Report — By day (cont.)', titlePeriod);
      rowIndex = 0;
    }
    const bg = rowIndex % 2 === 0 ? rgb(0.97, 0.97, 0.97) : rgb(1, 1, 1);
    page.drawRectangle({ x: 40, y: y - 2, width: 515, height: 13, color: bg });

    page.drawText(String(d.day).slice(0, 10), { x: 52, y, size: 9, font: ctx.font, color: rgb(0.3, 0.3, 0.3) });
    const b = formatIDR(d.taxable_base);
    page.drawText(b, { x: 425 - ctx.font.widthOfTextAtSize(b, 9), y, size: 9, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    const c = formatIDR(d.pb1_collected);
    page.drawText(c, { x: 555 - ctx.font.widthOfTextAtSize(c, 9), y, size: 9, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    y -= 13;
    rowIndex++;
  }

  drawFooter(page, ctx, 1, 1);
}
