// supabase/functions/_shared/pdf-templates/stock_variance.ts
// ADR-027 — Stock Variance = démarque constatée (get_stock_variance_v3).
// Table: Product | Opening | In | Out | Wasted | Corrected | Closing — sorted by
// (|corrected| + |wasted|) desc, comme le rapport à l'écran. `Out` agrège les
// sorties de vente et la consommation de production (signées négatives).
import { rgb } from 'https://esm.sh/pdf-lib@1.17.1';
import { drawFooter, drawHeader, formatNumber, type LayoutContext } from '../pdf-layout.ts';

export interface StockVarianceRow {
  product_name: string;
  opening:      number;
  stock_in:     number;
  sold:         number;
  consumed:     number;
  wasted:       number;
  corrected:    number;
  other:        number;
  closing:      number;
  current_qty:  number;
}

export type StockVarianceData = StockVarianceRow[];

const COL_PRODUCT   = 40;
const COL_OPENING   = 185;
const COL_IN        = 250;
const COL_OUT       = 315;
const COL_WASTED    = 380;
const COL_CORRECTED = 445;
const COL_CLOSING   = 505;
const ROWS_PER_PAGE = 38;
const ROW_H         = 14;

function drawTableHeader(page: ReturnType<typeof Object.assign>, ctx: LayoutContext, y: number): number {
  page.drawText('Product',   { x: COL_PRODUCT,   y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Opening',   { x: COL_OPENING,   y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('In',        { x: COL_IN,        y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Out',       { x: COL_OUT,       y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Wasted',    { x: COL_WASTED,    y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Corrected', { x: COL_CORRECTED, y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Closing',   { x: COL_CLOSING,   y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
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
  // Même pertinence que l'écran : corrections d'inventaire + pertes d'abord.
  const sorted = [...data].sort(
    (a, b) => (Math.abs(b.corrected) + Math.abs(b.wasted)) - (Math.abs(a.corrected) + Math.abs(a.wasted)),
  );

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

    const out = row.sold + row.consumed;
    const corColor = row.corrected < 0 ? rgb(0.7, 0, 0) : row.corrected > 0 ? rgb(0, 0.5, 0) : rgb(0.1, 0.1, 0.1);
    const wasteColor = row.wasted < 0 ? rgb(0.7, 0, 0) : rgb(0.1, 0.1, 0.1);

    page.drawText(truncate(row.product_name, 26), { x: COL_PRODUCT,   y, size: 8, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(formatNumber(row.opening),      { x: COL_OPENING,   y, size: 8, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(formatNumber(row.stock_in),     { x: COL_IN,        y, size: 8, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(formatNumber(out),              { x: COL_OUT,       y, size: 8, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(formatNumber(row.wasted),       { x: COL_WASTED,    y, size: 8, font: ctx.font, color: wasteColor });
    page.drawText(formatNumber(row.corrected),    { x: COL_CORRECTED, y, size: 8, font: ctx.font, color: corColor });
    page.drawText(formatNumber(row.closing),      { x: COL_CLOSING,   y, size: 8, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });

    y -= ROW_H;
    rowIndex++;
  }

  drawFooter(page, ctx, pageNum, totalPages);
}
