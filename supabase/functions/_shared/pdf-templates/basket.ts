// supabase/functions/_shared/pdf-templates/basket.ts
// S29 Wave 3.A.2 — Basket Analysis (market basket / co-occurrence) PDF template
// Table: Product A | Product B | Co-occurrence | Confidence | Lift
import { rgb } from 'https://esm.sh/pdf-lib@1.17.1';
import { drawFooter, drawHeader, formatNumber, formatPct, type LayoutContext } from '../pdf-layout.ts';

export interface BasketRow {
  product_a_name:    string;
  product_b_name:    string;
  co_occurrence_count: number;
  confidence:        number; // 0–1
  lift:              number;
}

export type BasketData = BasketRow[];

const COL_PROD_A     = 40;
const COL_PROD_B     = 190;
const COL_COOC       = 330;
const COL_CONFIDENCE = 410;
const COL_LIFT       = 490;
const ROWS_PER_PAGE  = 40;
const ROW_H          = 14;

function drawTableHeader(page: ReturnType<typeof Object.assign>, ctx: LayoutContext, y: number): number {
  const headers: Array<{ label: string; x: number }> = [
    { label: 'Product A',   x: COL_PROD_A     },
    { label: 'Product B',   x: COL_PROD_B     },
    { label: 'Co-occ.',     x: COL_COOC       },
    { label: 'Confidence',  x: COL_CONFIDENCE },
    { label: 'Lift',        x: COL_LIFT       },
  ];
  for (const h of headers) {
    page.drawText(h.label, { x: h.x, y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  }
  y -= 4;
  page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 0.3, color: rgb(0.7, 0.7, 0.7) });
  return y - 10;
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen - 1) + '…' : text;
}

export async function render(
  ctx:    LayoutContext,
  data:   BasketData,
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
    y = drawHeader(page, ctx, 'Basket Analysis', period ?? undefined);
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

    page.drawText(truncate(row.product_a_name, 20), { x: COL_PROD_A,     y, size: 8, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(truncate(row.product_b_name, 20), { x: COL_PROD_B,     y, size: 8, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(formatNumber(row.co_occurrence_count),            { x: COL_COOC,       y, size: 8, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(formatPct(row.confidence),                        { x: COL_CONFIDENCE, y, size: 8, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(row.lift.toFixed(2),                              { x: COL_LIFT,       y, size: 8, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });

    y -= ROW_H;
    rowIndex++;
  }

  drawFooter(page, ctx, pageNum, totalPages);
}
