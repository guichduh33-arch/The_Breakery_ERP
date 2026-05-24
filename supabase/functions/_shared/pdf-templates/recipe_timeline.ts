// supabase/functions/_shared/pdf-templates/recipe_timeline.ts
// S29 Wave 3.A.2 — Recipe Cost Timeline (single product) PDF template
// Header: product name centered. Table: Version | Cost | Δ% | Created
import { rgb } from 'https://esm.sh/pdf-lib@1.17.1';
import { drawFooter, drawHeader, formatIDR, formatPct, type LayoutContext } from '../pdf-layout.ts';

export interface RecipeTimelineRow {
  version:       number;
  cost_per_unit: number;
  delta_pct:     number | null;
  created_at:    string;
}

export interface RecipeTimelineData {
  product_name: string;
  rows:         RecipeTimelineRow[];
}

const COL_VERSION  = 60;
const COL_COST     = 160;
const COL_DELTA    = 310;
const COL_CREATED  = 400;
const ROWS_PER_PAGE = 40;
const ROW_H        = 14;

function drawTableHeader(page: ReturnType<typeof Object.assign>, ctx: LayoutContext, y: number): number {
  const headers: Array<{ label: string; x: number }> = [
    { label: 'Version', x: COL_VERSION },
    { label: 'Cost',    x: COL_COST    },
    { label: 'Δ%',      x: COL_DELTA   },
    { label: 'Created', x: COL_CREATED },
  ];
  for (const h of headers) {
    page.drawText(h.label, { x: h.x, y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  }
  y -= 4;
  page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 0.3, color: rgb(0.7, 0.7, 0.7) });
  return y - 10;
}

export async function render(
  ctx:    LayoutContext,
  data:   RecipeTimelineData,
  period: { start: string; end: string } | null,
): Promise<void> {
  const totalPages = Math.max(1, Math.ceil(data.rows.length / ROWS_PER_PAGE));
  let pageNum  = 0;
  let rowIndex = 0;
  // deno-lint-ignore no-explicit-any
  let page: any;
  let y = 0;

  const newPage = (): void => {
    pageNum++;
    page = ctx.doc.addPage([595, 842]);
    y = drawHeader(page, ctx, 'Recipe Cost Timeline', period ?? undefined);

    // Product name centered below header
    const nameLabel = data.product_name;
    const { width } = page.getSize();
    page.drawText(nameLabel, {
      x: (width - ctx.fontBold.widthOfTextAtSize(nameLabel, 12)) / 2,
      y, size: 12, font: ctx.fontBold, color: rgb(0.15, 0.35, 0.65),
    });
    y -= 20;

    y = drawTableHeader(page, ctx, y);
  };

  newPage();

  for (const row of data.rows) {
    if (y < 80) {
      drawFooter(page, ctx, pageNum, totalPages);
      newPage();
    }

    const bg = rowIndex % 2 === 0 ? rgb(0.97, 0.97, 0.97) : rgb(1, 1, 1);
    page.drawRectangle({ x: 40, y: y - 2, width: 515, height: ROW_H, color: bg });

    const deltaPct = row.delta_pct;
    const deltaColor = deltaPct === null ? rgb(0.5, 0.5, 0.5) : deltaPct > 0 ? rgb(0.7, 0, 0) : rgb(0, 0.5, 0);

    page.drawText(`v${row.version}`,                                      { x: COL_VERSION, y, size: 8, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(formatIDR(row.cost_per_unit),                           { x: COL_COST,    y, size: 8, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(deltaPct !== null ? formatPct(deltaPct) : '—',          { x: COL_DELTA,   y, size: 8, font: ctx.font, color: deltaColor });
    page.drawText(row.created_at.slice(0, 16).replace('T', ' '),          { x: COL_CREATED, y, size: 8, font: ctx.font, color: rgb(0.4, 0.4, 0.4) });

    y -= ROW_H;
    rowIndex++;
  }

  drawFooter(page, ctx, pageNum, totalPages);
}
