// supabase/functions/_shared/pdf-templates/wastage.ts
// S30 Wave 3.1 — Wastage & Spoilage PDF template
import { rgb } from 'https://esm.sh/pdf-lib@1.17.1';
import { drawFooter, drawHeader, formatIDR, type LayoutContext } from '../pdf-layout.ts';

export interface WastageData {
  period: { start: string; end: string };
  summary: {
    total_manual_waste_qty:   number;
    total_manual_waste_value: number;
    total_spoilage_qty:       number;
    total_spoilage_value:     number;
    total_qty:                number;
    total_value:              number;
    line_count:               number;
  };
  by_product: Array<{
    product_id:          string;
    product_name:        string;
    manual_waste_qty:    number;
    manual_waste_value:  number;
    spoilage_qty:        number;
    spoilage_value:      number;
    total_qty:           number;
    total_value:         number;
  }>;
  lines: Array<{
    id:               string;
    product_name:     string;
    type:             'manual_waste' | 'spoilage';
    qty:              number;
    value:            number;
    lot_batch_number?: string | null;
    created_by_name?:  string | null;
    created_at:       string;
  }>;
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen - 1) + '…' : text;
}

export async function render(
  ctx:    LayoutContext,
  data:   WastageData,
  period: { start: string; end: string } | null,
): Promise<void> {
  let page = ctx.doc.addPage([595, 842]);
  let y = drawHeader(page, ctx, 'Wastage & Spoilage', period ?? data.period);

  // ── Summary ──────────────────────────────────────────────────────────────────
  page.drawText('Summary', { x: 40, y, size: 11, font: ctx.fontBold, color: rgb(0.1, 0.1, 0.1) });
  y -= 18;
  const summaryRows: Array<[string, string]> = [
    ['Manual waste qty',   String(data.summary.total_manual_waste_qty)],
    ['Manual waste value', formatIDR(data.summary.total_manual_waste_value)],
    ['Spoilage qty',       String(data.summary.total_spoilage_qty)],
    ['Spoilage value',     formatIDR(data.summary.total_spoilage_value)],
    ['Total qty',          String(data.summary.total_qty)],
    ['Total value',        formatIDR(data.summary.total_value)],
    ['Line count',         String(data.summary.line_count)],
  ];
  for (const [label, val] of summaryRows) {
    page.drawText(label, { x: 52, y, size: 9, font: ctx.font, color: rgb(0.2, 0.2, 0.2) });
    page.drawText(val, { x: 555 - ctx.font.widthOfTextAtSize(val, 9), y, size: 9, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    y -= 13;
  }
  y -= 8;

  // ── By product table ─────────────────────────────────────────────────────────
  page.drawText('By product', { x: 40, y, size: 11, font: ctx.fontBold, color: rgb(0.1, 0.1, 0.1) });
  y -= 16;
  page.drawText('Product',      { x: 52,  y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Waste qty',    { x: 280, y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Spoilage qty', { x: 360, y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Total value',  { x: 460, y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  y -= 4;
  page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 0.3, color: rgb(0.7, 0.7, 0.7) });
  y -= 12;

  let rowIndex = 0;
  for (const r of data.by_product) {
    if (y < 80) {
      drawFooter(page, ctx, 1, 1);
      page = ctx.doc.addPage([595, 842]);
      y = drawHeader(page, ctx, 'Wastage & Spoilage — By product (cont.)', data.period);
      rowIndex = 0;
    }
    const bg = rowIndex % 2 === 0 ? rgb(0.97, 0.97, 0.97) : rgb(1, 1, 1);
    page.drawRectangle({ x: 40, y: y - 2, width: 515, height: 13, color: bg });

    page.drawText(truncate(r.product_name, 38), { x: 52,  y, size: 9, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    const wq = String(r.manual_waste_qty);
    page.drawText(wq, { x: 335 - ctx.font.widthOfTextAtSize(wq, 9), y, size: 9, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    const sq = String(r.spoilage_qty);
    page.drawText(sq, { x: 415 - ctx.font.widthOfTextAtSize(sq, 9), y, size: 9, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    const tv = formatIDR(r.total_value);
    page.drawText(tv, { x: 555 - ctx.font.widthOfTextAtSize(tv, 9), y, size: 9, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });

    y -= 13;
    rowIndex++;
  }

  drawFooter(page, ctx, 1, 1);
}
