// supabase/functions/_shared/pdf-templates/pnl.ts
// S29 Wave 3.A.2 — Profit & Loss PDF template
import { rgb } from 'https://esm.sh/pdf-lib@1.17.1';
import { drawFooter, drawHeader, formatIDR, type LayoutContext } from '../pdf-layout.ts';

export interface PnlData {
  revenue: {
    sales:       number;
    discounts:   number;
    adjustments: number;
    total:       number;
  };
  cogs: {
    production: number;
    waste:      number;
    other:      number;
    total:      number;
  };
  gross_profit:     number;
  opex: {
    salary:      number;
    rent:        number;
    utilities:   number;
    supplies:    number;
    marketing:   number;
    maintenance: number;
    other:       number;
    total:       number;
  };
  operating_profit: number;
  net_profit:       number;
  lines: Array<{
    code:    string;
    name:    string;
    debit:   number;
    credit:  number;
    balance: number;
  }>;
}

export async function render(
  ctx:    LayoutContext,
  data:   PnlData,
  period: { start: string; end: string } | null,
): Promise<void> {
  const page = ctx.doc.addPage([595, 842]);
  let y = drawHeader(page, ctx, 'Profit & Loss', period ?? undefined);

  const drawRow = (label: string, value: number, indent = 0, bold = false): void => {
    const font = bold ? ctx.fontBold : ctx.font;
    page.drawText(label, { x: 40 + indent * 12, y, size: 10, font, color: rgb(0.1, 0.1, 0.1) });
    const valStr = formatIDR(value);
    page.drawText(valStr, {
      x: 555 - ctx.font.widthOfTextAtSize(valStr, 10),
      y, size: 10, font, color: rgb(0.1, 0.1, 0.1),
    });
    y -= 16;
  };

  // Revenue section
  drawRow('Revenue', data.revenue.total, 0, true);
  drawRow('Sales',       data.revenue.sales,       1);
  drawRow('Discounts',   data.revenue.discounts,   1);
  drawRow('Adjustments', data.revenue.adjustments, 1);
  y -= 4;

  // COGS section
  drawRow('Cost of Goods Sold', data.cogs.total, 0, true);
  drawRow('Production', data.cogs.production, 1);
  drawRow('Waste',      data.cogs.waste,      1);
  drawRow('Other',      data.cogs.other,      1);
  y -= 4;

  drawRow('Gross Profit', data.gross_profit, 0, true);
  y -= 4;

  // Opex section
  drawRow('Operating Expenses', data.opex.total, 0, true);
  drawRow('Salary & Wages', data.opex.salary,      1);
  drawRow('Rent',           data.opex.rent,        1);
  drawRow('Utilities',      data.opex.utilities,   1);
  drawRow('Supplies',       data.opex.supplies,    1);
  drawRow('Marketing',      data.opex.marketing,   1);
  drawRow('Maintenance',    data.opex.maintenance, 1);
  drawRow('Other',          data.opex.other,       1);
  y -= 4;

  drawRow('Net Profit', data.net_profit, 0, true);

  drawFooter(page, ctx, 1, 1);
}
