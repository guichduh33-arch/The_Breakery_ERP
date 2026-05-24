// supabase/functions/_shared/pdf-templates/sales_by_staff.ts
// S29 Wave 3.A.2 — Sales by Staff PDF template
// Table: Staff | Revenue | Orders | Avg Basket
import { rgb } from 'https://esm.sh/pdf-lib@1.17.1';
import { drawFooter, drawHeader, formatIDR, formatNumber, type LayoutContext } from '../pdf-layout.ts';

export interface SalesByStaffRow {
  staff_name:  string;
  revenue:     number;
  orders:      number;
  avg_basket:  number;
}

export type SalesByStaffData = SalesByStaffRow[];

const COL_STAFF      = 40;
const COL_REVENUE    = 220;
const COL_ORDERS     = 360;
const COL_AVG_BASKET = 440;
const ROWS_PER_PAGE  = 40;
const ROW_H          = 14;

function drawTableHeader(page: ReturnType<typeof Object.assign>, ctx: LayoutContext, y: number): number {
  page.drawText('Staff',      { x: COL_STAFF,      y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Revenue',    { x: COL_REVENUE,    y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Orders',     { x: COL_ORDERS,     y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Avg Basket', { x: COL_AVG_BASKET, y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  y -= 4;
  page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 0.3, color: rgb(0.7, 0.7, 0.7) });
  return y - 10;
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen - 1) + '…' : text;
}

export async function render(
  ctx:    LayoutContext,
  data:   SalesByStaffData,
  period: { start: string; end: string } | null,
): Promise<void> {
  const totalPages = Math.max(1, Math.ceil(data.length / ROWS_PER_PAGE));
  let pageNum  = 0;
  let rowIndex = 0;
  // deno-lint-ignore no-explicit-any
  let page: any;
  let y = 0;

  let grandRevenue = 0;
  let grandOrders  = 0;

  const newPage = (): void => {
    pageNum++;
    page = ctx.doc.addPage([595, 842]);
    y = drawHeader(page, ctx, 'Sales by Staff', period ?? undefined);
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

    page.drawText(truncate(row.staff_name, 25), { x: COL_STAFF,      y, size: 9, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(formatIDR(row.revenue),       { x: COL_REVENUE,    y, size: 9, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(formatNumber(row.orders),     { x: COL_ORDERS,     y, size: 9, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(formatIDR(row.avg_basket),    { x: COL_AVG_BASKET, y, size: 9, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });

    grandRevenue += row.revenue;
    grandOrders  += row.orders;
    y -= ROW_H;
    rowIndex++;
  }

  // Totals row
  y -= 4;
  page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 0.3, color: rgb(0.7, 0.7, 0.7) });
  y -= 12;

  const grandAvg = grandOrders > 0 ? grandRevenue / grandOrders : 0;
  page.drawText('TOTAL',                { x: COL_STAFF,      y, size: 9, font: ctx.fontBold, color: rgb(0.1, 0.1, 0.1) });
  page.drawText(formatIDR(grandRevenue),{ x: COL_REVENUE,    y, size: 9, font: ctx.fontBold, color: rgb(0.1, 0.1, 0.1) });
  page.drawText(formatNumber(grandOrders), { x: COL_ORDERS,  y, size: 9, font: ctx.fontBold, color: rgb(0.1, 0.1, 0.1) });
  page.drawText(formatIDR(grandAvg),    { x: COL_AVG_BASKET, y, size: 9, font: ctx.fontBold, color: rgb(0.1, 0.1, 0.1) });

  drawFooter(page, ctx, pageNum, totalPages);
}
