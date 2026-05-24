// supabase/functions/_shared/pdf-templates/sales_by_hour.ts
// S29 Wave 3.A.2 — Sales by Hour PDF template
// Table: Hour | Revenue | Orders (24 rows max — single page)
import { rgb } from 'https://esm.sh/pdf-lib@1.17.1';
import { drawFooter, drawHeader, formatIDR, formatNumber, type LayoutContext } from '../pdf-layout.ts';

export interface SalesByHourRow {
  hour:    number; // 0–23
  revenue: number;
  orders:  number;
}

export type SalesByHourData = SalesByHourRow[];

const COL_HOUR    = 60;
const COL_REVENUE = 200;
const COL_ORDERS  = 380;
const ROW_H       = 16;

function padHour(h: number): string {
  return `${String(h).padStart(2, '0')}:00 – ${String(h).padStart(2, '0')}:59`;
}

export async function render(
  ctx:    LayoutContext,
  data:   SalesByHourData,
  period: { start: string; end: string } | null,
): Promise<void> {
  const page = ctx.doc.addPage([595, 842]);
  let y = drawHeader(page, ctx, 'Sales by Hour', period ?? undefined);

  // Table header
  page.drawText('Hour',    { x: COL_HOUR,    y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Revenue', { x: COL_REVENUE, y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Orders',  { x: COL_ORDERS,  y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  y -= 4;
  page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 0.3, color: rgb(0.7, 0.7, 0.7) });
  y -= 12;

  // Compute totals for summary row
  let totalRevenue = 0;
  let totalOrders  = 0;

  // Sort by hour ascending (caller may not guarantee order)
  const sorted = [...data].sort((a, b) => a.hour - b.hour);

  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i];
    const bg = i % 2 === 0 ? rgb(0.97, 0.97, 0.97) : rgb(1, 1, 1);
    page.drawRectangle({ x: 40, y: y - 2, width: 515, height: ROW_H, color: bg });

    page.drawText(padHour(row.hour),         { x: COL_HOUR,    y, size: 9, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(formatIDR(row.revenue),    { x: COL_REVENUE, y, size: 9, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(formatNumber(row.orders),  { x: COL_ORDERS,  y, size: 9, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });

    totalRevenue += row.revenue;
    totalOrders  += row.orders;
    y -= ROW_H;
  }

  // Totals row
  y -= 4;
  page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 0.3, color: rgb(0.7, 0.7, 0.7) });
  y -= 12;
  page.drawText('TOTAL', { x: COL_HOUR, y, size: 9, font: ctx.fontBold, color: rgb(0.1, 0.1, 0.1) });
  page.drawText(formatIDR(totalRevenue),   { x: COL_REVENUE, y, size: 9, font: ctx.fontBold, color: rgb(0.1, 0.1, 0.1) });
  page.drawText(formatNumber(totalOrders), { x: COL_ORDERS,  y, size: 9, font: ctx.fontBold, color: rgb(0.1, 0.1, 0.1) });

  drawFooter(page, ctx, 1, 1);
}
