// supabase/functions/_shared/pdf-templates/sales_by_category.ts
// S29 Wave 3.A.2 — Sales by Category PDF template
// Table: Category | Revenue | Qty
import { rgb } from 'https://esm.sh/pdf-lib@1.17.1';
import { drawFooter, drawHeader, formatIDR, formatNumber, type LayoutContext } from '../pdf-layout.ts';

export interface SalesByCategoryRow {
  category: string;
  revenue:  number;
  qty:      number;
}

export type SalesByCategoryData = SalesByCategoryRow[];

const COL_CATEGORY = 40;
const COL_REVENUE  = 280;
const COL_QTY      = 420;
const ROWS_PER_PAGE = 40;
const ROW_H        = 14;

function drawTableHeader(page: ReturnType<typeof Object.assign>, ctx: LayoutContext, y: number): number {
  page.drawText('Category', { x: COL_CATEGORY, y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Revenue',  { x: COL_REVENUE,  y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Qty',      { x: COL_QTY,      y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  y -= 4;
  page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 0.3, color: rgb(0.7, 0.7, 0.7) });
  return y - 10;
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen - 1) + '…' : text;
}

export async function render(
  ctx:    LayoutContext,
  data:   SalesByCategoryData,
  period: { start: string; end: string } | null,
): Promise<void> {
  const totalPages = Math.max(1, Math.ceil(data.length / ROWS_PER_PAGE));
  let pageNum  = 0;
  let rowIndex = 0;
  // deno-lint-ignore no-explicit-any
  let page: any;
  let y = 0;

  let grandRevenue = 0;
  let grandQty     = 0;

  const newPage = (): void => {
    pageNum++;
    page = ctx.doc.addPage([595, 842]);
    y = drawHeader(page, ctx, 'Sales by Category', period ?? undefined);
    y = drawTableHeader(page, ctx, y);
  };

  newPage();

  for (const row of data) {
    if (y < 80) {
      drawFooter(page, ctx, pageNum, totalPages);
      newPage();
    }

    const bg = rowIndex % 2 === 0 ? rgb(0.97, 0.97, 0.97) : rgb(1, 1, 1);
    page.drawRectangle({ x: 40, y: y - 2, width: 515, height: ROW_H, color: bg });

    page.drawText(truncate(row.category, 32), { x: COL_CATEGORY, y, size: 9, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(formatIDR(row.revenue),     { x: COL_REVENUE,  y, size: 9, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(formatNumber(row.qty),      { x: COL_QTY,      y, size: 9, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });

    grandRevenue += row.revenue;
    grandQty     += row.qty;
    y -= ROW_H;
    rowIndex++;
  }

  // Totals row on last page
  y -= 4;
  page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 0.3, color: rgb(0.7, 0.7, 0.7) });
  y -= 12;
  page.drawText('TOTAL',                { x: COL_CATEGORY, y, size: 9, font: ctx.fontBold, color: rgb(0.1, 0.1, 0.1) });
  page.drawText(formatIDR(grandRevenue),{ x: COL_REVENUE,  y, size: 9, font: ctx.fontBold, color: rgb(0.1, 0.1, 0.1) });
  page.drawText(formatNumber(grandQty), { x: COL_QTY,      y, size: 9, font: ctx.fontBold, color: rgb(0.1, 0.1, 0.1) });

  drawFooter(page, ctx, pageNum, totalPages);
}
