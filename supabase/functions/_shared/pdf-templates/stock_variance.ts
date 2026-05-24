// supabase/functions/_shared/pdf-templates/stock_variance.ts
// S29 Wave 3.A.2 — Stock Variance PDF template
// Table: Product | Expected | Current | Variance | % — sorted by |variance| desc
import { rgb } from 'https://esm.sh/pdf-lib@1.17.1';
import { drawFooter, drawHeader, formatNumber, formatPct, type LayoutContext } from '../pdf-layout.ts';

export interface StockVarianceRow {
  product_name:  string;
  expected:      number;
  current:       number;
  variance:      number;
  variance_pct:  number; // ratio, e.g. -0.05 = -5%
}

export type StockVarianceData = StockVarianceRow[];

const COL_PRODUCT  = 40;
const COL_EXPECTED = 210;
const COL_CURRENT  = 290;
const COL_VARIANCE = 370;
const COL_PCT      = 460;
const ROWS_PER_PAGE = 38;
const ROW_H        = 14;

function drawTableHeader(page: ReturnType<typeof Object.assign>, ctx: LayoutContext, y: number): number {
  page.drawText('Product',   { x: COL_PRODUCT,  y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Expected',  { x: COL_EXPECTED, y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Current',   { x: COL_CURRENT,  y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Variance',  { x: COL_VARIANCE, y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('%',         { x: COL_PCT,      y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  y -= 4;
  page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 0.3, color: rgb(0.7, 0.7, 0.7) });
  return y - 10;
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen - 1) + '…' : text;
}

export async function render(
  ctx:    LayoutContext,
  data:   StockVarianceData,
  period: { start: string; end: string } | null,
): Promise<void> {
  // Sort by absolute variance descending
  const sorted = [...data].sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));

  const totalPages = Math.max(1, Math.ceil(sorted.length / ROWS_PER_PAGE));
  let pageNum  = 0;
  let rowIndex = 0;
  // deno-lint-ignore no-explicit-any
  let page: any;
  let y = 0;

  const newPage = (): void => {
    pageNum++;
    page = ctx.doc.addPage([595, 842]);
    y = drawHeader(page, ctx, 'Stock Variance', period ?? undefined);
    y = drawTableHeader(page, ctx, y);
  };

  newPage();

  for (const row of sorted) {
    if (y < 80) {
      drawFooter(page, ctx, pageNum, totalPages);
      newPage();
    }

    const bg = rowIndex % 2 === 0 ? rgb(0.97, 0.97, 0.97) : rgb(1, 1, 1);
    page.drawRectangle({ x: 40, y: y - 2, width: 515, height: ROW_H, color: bg });

    const varColor = row.variance < 0 ? rgb(0.7, 0, 0) : row.variance > 0 ? rgb(0, 0.5, 0) : rgb(0.1, 0.1, 0.1);

    page.drawText(truncate(row.product_name, 24),  { x: COL_PRODUCT,  y, size: 8, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(formatNumber(row.expected),       { x: COL_EXPECTED, y, size: 8, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(formatNumber(row.current),        { x: COL_CURRENT,  y, size: 8, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(formatNumber(row.variance),       { x: COL_VARIANCE, y, size: 8, font: ctx.font, color: varColor });
    page.drawText(formatPct(row.variance_pct),      { x: COL_PCT,      y, size: 8, font: ctx.font, color: varColor });

    y -= ROW_H;
    rowIndex++;
  }

  drawFooter(page, ctx, pageNum, totalPages);
}
