// supabase/functions/_shared/pdf-templates/cf.ts
// S29 Wave 3.A.2 — Cash Flow Statement PDF template (3-section: operating / investing / financing)
import { rgb } from 'https://esm.sh/pdf-lib@1.17.1';
import { drawFooter, drawHeader, formatIDR, type LayoutContext } from '../pdf-layout.ts';

export interface CfData {
  operating: {
    net_income:            number;
    depreciation:          number;
    changes_in_ar:         number;
    changes_in_ap:         number;
    changes_in_inventory:  number;
    total:                 number;
  };
  investing: {
    equipment_purchases: number;
    other:               number;
    total:               number;
  };
  financing: {
    loans_received:  number;
    loans_paid:      number;
    equity_changes:  number;
    total:           number;
  };
  net_change:     number;
  beginning_cash: number;
  ending_cash:    number;
}

export async function render(
  ctx:    LayoutContext,
  data:   CfData,
  period: { start: string; end: string } | null,
): Promise<void> {
  const page = ctx.doc.addPage([595, 842]);
  let y = drawHeader(page, ctx, 'Cash Flow Statement', period ?? undefined);

  const drawRow = (label: string, value: number, indent = 0, bold = false): void => {
    const font = bold ? ctx.fontBold : ctx.font;
    page.drawText(label, { x: 40 + indent * 12, y, size: 10, font, color: rgb(0.1, 0.1, 0.1) });
    const valStr = formatIDR(value);
    // Negative values in parentheses style — keep raw sign but color red
    const isNeg = value < 0;
    page.drawText(valStr, {
      x: 555 - ctx.font.widthOfTextAtSize(valStr, 10),
      y, size: 10, font,
      color: isNeg ? rgb(0.7, 0, 0) : rgb(0.1, 0.1, 0.1),
    });
    y -= 16;
  };

  const drawSectionHeader = (label: string): void => {
    page.drawText(label, { x: 40, y, size: 11, font: ctx.fontBold, color: rgb(0.15, 0.35, 0.65) });
    y -= 18;
  };

  // ── OPERATING ────────────────────────────────────────────────────────────────
  drawSectionHeader('Operating Activities');
  drawRow('Net Income',               data.operating.net_income,           1);
  drawRow('Depreciation',             data.operating.depreciation,         1);
  drawRow('Changes in A/R',           data.operating.changes_in_ar,        1);
  drawRow('Changes in A/P',           data.operating.changes_in_ap,        1);
  drawRow('Changes in Inventory',     data.operating.changes_in_inventory, 1);
  drawRow('Net Cash from Operations', data.operating.total,                0, true);
  y -= 8;

  // ── INVESTING ────────────────────────────────────────────────────────────────
  drawSectionHeader('Investing Activities');
  drawRow('Equipment Purchases', data.investing.equipment_purchases, 1);
  drawRow('Other',               data.investing.other,               1);
  drawRow('Net Cash from Investing', data.investing.total,           0, true);
  y -= 8;

  // ── FINANCING ────────────────────────────────────────────────────────────────
  drawSectionHeader('Financing Activities');
  drawRow('Loans Received',  data.financing.loans_received, 1);
  drawRow('Loans Paid',      data.financing.loans_paid,     1);
  drawRow('Equity Changes',  data.financing.equity_changes, 1);
  drawRow('Net Cash from Financing', data.financing.total,  0, true);
  y -= 12;

  // ── SUMMARY ──────────────────────────────────────────────────────────────────
  page.drawLine({
    start: { x: 40, y: y + 12 }, end: { x: 555, y: y + 12 },
    thickness: 0.5, color: rgb(0.7, 0.7, 0.7),
  });
  drawRow('Net Change in Cash',  data.net_change,     0, true);
  drawRow('Beginning Cash',      data.beginning_cash, 0, false);
  drawRow('Ending Cash Balance', data.ending_cash,    0, true);

  drawFooter(page, ctx, 1, 1);
}
