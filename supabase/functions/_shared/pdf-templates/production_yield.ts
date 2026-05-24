// supabase/functions/_shared/pdf-templates/production_yield.ts
// S29 Wave 3.A.2 — Production Yield PDF template
// Table: Production # | Recipe | Expected | Actual | Δ% | Status
import { rgb } from 'https://esm.sh/pdf-lib@1.17.1';
import { drawFooter, drawHeader, formatNumber, formatPct, type LayoutContext } from '../pdf-layout.ts';

export interface ProductionYieldRow {
  production_number: string;
  recipe_name:       string;
  expected_yield:    number;
  actual_yield:      number;
  variance_pct:      number; // ratio
  status:            string;
}

export type ProductionYieldData = ProductionYieldRow[];

const COL_PROD_NO  = 40;
const COL_RECIPE   = 120;
const COL_EXPECTED = 280;
const COL_ACTUAL   = 340;
const COL_DELTA    = 400;
const COL_STATUS   = 460;
const ROWS_PER_PAGE = 38;
const ROW_H        = 14;

function drawTableHeader(page: ReturnType<typeof Object.assign>, ctx: LayoutContext, y: number): number {
  page.drawText('Prod #',    { x: COL_PROD_NO,  y, size: 8, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Recipe',    { x: COL_RECIPE,   y, size: 8, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Expected',  { x: COL_EXPECTED, y, size: 8, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Actual',    { x: COL_ACTUAL,   y, size: 8, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Δ%',        { x: COL_DELTA,    y, size: 8, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Status',    { x: COL_STATUS,   y, size: 8, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  y -= 4;
  page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 0.3, color: rgb(0.7, 0.7, 0.7) });
  return y - 10;
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen - 1) + '…' : text;
}

function statusColor(status: string): ReturnType<typeof rgb> {
  const s = status.toLowerCase();
  if (s === 'completed' || s === 'ok')    return rgb(0, 0.5, 0);
  if (s === 'failed'    || s === 'error') return rgb(0.7, 0, 0);
  if (s === 'in_progress' || s === 'processing') return rgb(0.6, 0.4, 0);
  return rgb(0.3, 0.3, 0.3);
}

export async function render(
  ctx:    LayoutContext,
  data:   ProductionYieldData,
  period: { start: string; end: string } | null,
): Promise<void> {
  const totalPages = Math.max(1, Math.ceil(data.length / ROWS_PER_PAGE));
  let pageNum  = 0;
  let rowIndex = 0;
  // deno-lint-ignore no-explicit-any
  let page: any;
  let y = 0;

  const newPage = (): void => {
    pageNum++;
    page = ctx.doc.addPage([595, 842]);
    y = drawHeader(page, ctx, 'Production Yield', period ?? undefined);
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

    const deltaColor = row.variance_pct < -0.05 ? rgb(0.7, 0, 0) : row.variance_pct > 0.05 ? rgb(0, 0.5, 0) : rgb(0.1, 0.1, 0.1);

    page.drawText(truncate(row.production_number, 10), { x: COL_PROD_NO,  y, size: 8, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(truncate(row.recipe_name, 20),        { x: COL_RECIPE,   y, size: 8, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(formatNumber(row.expected_yield),     { x: COL_EXPECTED, y, size: 8, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(formatNumber(row.actual_yield),       { x: COL_ACTUAL,   y, size: 8, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(formatPct(row.variance_pct),          { x: COL_DELTA,    y, size: 8, font: ctx.font, color: deltaColor });
    page.drawText(truncate(row.status, 12),             { x: COL_STATUS,   y, size: 8, font: ctx.font, color: statusColor(row.status) });

    y -= ROW_H;
    rowIndex++;
  }

  drawFooter(page, ctx, pageNum, totalPages);
}
