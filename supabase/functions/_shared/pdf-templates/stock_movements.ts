// supabase/functions/_shared/pdf-templates/stock_movements.ts
// S30 Wave 3.1 — Stock Movements ledger PDF template
import { rgb } from 'https://esm.sh/pdf-lib@1.17.1';
import { drawFooter, drawHeader, formatIDR, type LayoutContext } from '../pdf-layout.ts';

export interface StockMovementsData {
  lines: Array<{
    id:               string;
    product_name:     string;
    movement_type:    string;
    quantity:         number;
    unit_cost:        number | null;
    value:            number;
    reference_type:   string | null;
    created_by_name?: string | null;
    created_at:       string;
  }>;
  next_cursor?: string | null;
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
  page.drawText('Timestamp',  { x: 40,  y, size: 8, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Product',    { x: 130, y, size: 8, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Type',       { x: 295, y, size: 8, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Qty',        { x: 375, y, size: 8, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Value',      { x: 435, y, size: 8, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Ref type',   { x: 500, y, size: 8, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  y -= 4;
  page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 0.3, color: rgb(0.7, 0.7, 0.7) });
  return y - 10;
}

export async function render(
  ctx:    LayoutContext,
  data:   StockMovementsData,
  period: { start: string; end: string } | null,
): Promise<void> {
  const lines = data.lines ?? [];
  const ROWS_PER_PAGE = 38;
  const totalPages = Math.max(1, Math.ceil(lines.length / ROWS_PER_PAGE));
  let pageNum = 0;
  // deno-lint-ignore no-explicit-any
  let page: any;
  let y = 0;

  const newPage = (): void => {
    pageNum++;
    page = ctx.doc.addPage([595, 842]);
    y = drawHeader(page, ctx, 'Stock Movements', period ?? undefined);
    y = drawTableHeader(page, ctx, y);
  };

  newPage();

  let rowIndex = 0;
  for (const l of lines) {
    if (y < 80) {
      drawFooter(page, ctx, pageNum, totalPages);
      newPage();
      rowIndex = 0;
    }
    const bg = rowIndex % 2 === 0 ? rgb(0.97, 0.97, 0.97) : rgb(1, 1, 1);
    page.drawRectangle({ x: 40, y: y - 2, width: 515, height: 11, color: bg });

    page.drawText(l.created_at.slice(0, 16).replace('T', ' '), { x: 40,  y, size: 8, font: ctx.font, color: rgb(0.3, 0.3, 0.3) });
    page.drawText(truncate(l.product_name, 22),                 { x: 130, y, size: 8, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(truncate(l.movement_type, 16),                { x: 295, y, size: 8, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    const q = String(l.quantity);
    page.drawText(q, { x: 430 - ctx.font.widthOfTextAtSize(q, 8), y, size: 8, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    const v = formatIDR(l.value);
    page.drawText(v, { x: 495 - ctx.font.widthOfTextAtSize(v, 8), y, size: 8, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(truncate(l.reference_type ?? '—', 10),         { x: 500, y, size: 8, font: ctx.font, color: rgb(0.4, 0.4, 0.4) });

    y -= 11;
    rowIndex++;
  }

  drawFooter(page, ctx, pageNum, totalPages);
}
