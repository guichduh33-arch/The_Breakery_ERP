// supabase/functions/_shared/pdf-templates/recipe_overview.ts
// S29 Wave 3.A.2 — Recipe Cost Overview PDF template
// Table: Product | Unit cost | Baseline | Δ% | Changes | Created at
import { rgb } from 'https://esm.sh/pdf-lib@1.17.1';
import { drawFooter, drawHeader, formatIDR, formatPct, type LayoutContext } from '../pdf-layout.ts';

export interface RecipeOverviewRow {
  product_name:  string;
  cost_per_unit: number;
  baseline_cost: number | null;
  delta_pct:     number | null;
  change_count:  number;
  created_at:    string | null;
}

export type RecipeOverviewData = RecipeOverviewRow[];

const COL_PRODUCT    = 40;
const COL_UNIT_COST  = 200;
const COL_BASELINE   = 285;
const COL_DELTA      = 365;
const COL_CHANGES    = 430;
const COL_CREATED    = 470;
const ROWS_PER_PAGE  = 38;
const ROW_H          = 14;

function drawTableHeader(page: ReturnType<typeof Object.assign>, ctx: LayoutContext, y: number): number {
  const headers: Array<{ label: string; x: number }> = [
    { label: 'Product',    x: COL_PRODUCT   },
    { label: 'Unit Cost',  x: COL_UNIT_COST },
    { label: 'Baseline',   x: COL_BASELINE  },
    { label: 'Δ%',         x: COL_DELTA     },
    { label: 'Changes',    x: COL_CHANGES   },
    { label: 'Created',    x: COL_CREATED   },
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

function shortDate(iso: string | null): string {
  if (!iso) return '—';
  return iso.slice(0, 10);
}

export async function render(
  ctx:    LayoutContext,
  data:   RecipeOverviewData,
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
    y = drawHeader(page, ctx, 'Recipe Cost Overview', period ?? undefined);
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

    const deltaPct = row.delta_pct;
    const deltaColor = deltaPct === null ? rgb(0.5, 0.5, 0.5) : deltaPct > 0 ? rgb(0.7, 0, 0) : rgb(0, 0.5, 0);

    page.drawText(truncate(row.product_name, 22), { x: COL_PRODUCT,   y, size: 8, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(formatIDR(row.cost_per_unit),    { x: COL_UNIT_COST, y, size: 8, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(row.baseline_cost !== null ? formatIDR(row.baseline_cost) : '—', { x: COL_BASELINE, y, size: 8, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(deltaPct !== null ? formatPct(deltaPct) : '—', { x: COL_DELTA, y, size: 8, font: ctx.font, color: deltaColor });
    page.drawText(String(row.change_count), { x: COL_CHANGES, y, size: 8, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(shortDate(row.created_at), { x: COL_CREATED, y, size: 8, font: ctx.font, color: rgb(0.4, 0.4, 0.4) });

    y -= ROW_H;
    rowIndex++;
  }

  drawFooter(page, ctx, pageNum, totalPages);
}
