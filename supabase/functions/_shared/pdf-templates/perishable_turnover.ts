// supabase/functions/_shared/pdf-templates/perishable_turnover.ts
// S30 Wave 3.1 — Perishable Lot Turnover PDF template
import { rgb } from 'https://esm.sh/pdf-lib@1.17.1';
import { drawFooter, drawHeader, type LayoutContext } from '../pdf-layout.ts';

export interface PerishableTurnoverData {
  period: { start: string; end: string };
  by_product: Array<{
    product_id:          string;
    product_name:        string;
    lots_count:          number;
    consumed_qty:        number;
    expired_qty:         number;
    current_active_qty:  number;
    waste_pct:           number;
    avg_days_in_stock:   number | null;
    shelf_life_days_p50: number | null;
    velocity_score:      number;
  }>;
}

/** Convert a 0–5 velocity_score to ASCII star rating. */
function stars(score: number): string {
  const n = Math.max(0, Math.min(5, Math.round(score)));
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen - 1) + '…' : text;
}

function drawTableHeader(
  // deno-lint-ignore no-explicit-any
  page: any,
  ctx: LayoutContext,
  y: number,
): number {
  page.drawText('Product',   { x: 40,  y, size: 8, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Lots',      { x: 215, y, size: 8, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Consumed',  { x: 255, y, size: 8, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Expired',   { x: 320, y, size: 8, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Active',    { x: 380, y, size: 8, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Waste%',    { x: 425, y, size: 8, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Avg days',  { x: 468, y, size: 8, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Velocity',  { x: 515, y, size: 8, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  y -= 4;
  page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 0.3, color: rgb(0.7, 0.7, 0.7) });
  return y - 10;
}

export async function render(
  ctx:    LayoutContext,
  data:   PerishableTurnoverData,
  period: { start: string; end: string } | null,
): Promise<void> {
  const rows = data.by_product ?? [];
  const ROWS_PER_PAGE = 38;
  const totalPages = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));
  let pageNum = 0;
  // deno-lint-ignore no-explicit-any
  let page: any;
  let y = 0;

  const newPage = (): void => {
    pageNum++;
    page = ctx.doc.addPage([595, 842]);
    y = drawHeader(page, ctx, 'Perishable Turnover', period ?? data.period);
    y = drawTableHeader(page, ctx, y);
  };

  newPage();

  let rowIndex = 0;
  for (const r of rows) {
    if (y < 80) {
      drawFooter(page, ctx, pageNum, totalPages);
      newPage();
      rowIndex = 0;
    }
    const bg = rowIndex % 2 === 0 ? rgb(0.97, 0.97, 0.97) : rgb(1, 1, 1);
    page.drawRectangle({ x: 40, y: y - 2, width: 515, height: 11, color: bg });

    page.drawText(truncate(r.product_name, 26), { x: 40,  y, size: 8, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(String(r.lots_count),          { x: 215, y, size: 8, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(String(r.consumed_qty),         { x: 255, y, size: 8, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(String(r.expired_qty),          { x: 320, y, size: 8, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(String(r.current_active_qty),   { x: 380, y, size: 8, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });

    const wpctStr = `${r.waste_pct.toFixed(1)}%`;
    const wasteColor = r.waste_pct > 20 ? rgb(0.7, 0, 0) : r.waste_pct > 10 ? rgb(0.6, 0.4, 0) : rgb(0, 0.5, 0);
    page.drawText(wpctStr, { x: 425, y, size: 8, font: ctx.font, color: wasteColor });

    const avgStr = r.avg_days_in_stock !== null ? String(r.avg_days_in_stock) : '—';
    page.drawText(avgStr, { x: 468, y, size: 8, font: ctx.font, color: rgb(0.3, 0.3, 0.3) });

    page.drawText(stars(r.velocity_score), { x: 515, y, size: 8, font: ctx.font, color: rgb(0.95, 0.65, 0.0) });

    y -= 11;
    rowIndex++;
  }

  drawFooter(page, ctx, pageNum, totalPages);
}
