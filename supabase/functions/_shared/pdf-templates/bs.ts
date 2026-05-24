// supabase/functions/_shared/pdf-templates/bs.ts
// S29 Wave 3.A.2 — Balance Sheet PDF template
import { rgb } from 'https://esm.sh/pdf-lib@1.17.1';
import { drawFooter, drawHeader, formatIDR, type LayoutContext } from '../pdf-layout.ts';

export interface BsData {
  as_of_date: string;
  assets: {
    current_assets: {
      cash:      number;
      ar:        number;
      inventory: number;
      total:     number;
    };
    non_current_assets: {
      equipment: number;
      other:     number;
      total:     number;
    };
    total: number;
  };
  liabilities: {
    current_liabilities: {
      ap:    number;
      other: number;
      total: number;
    };
    non_current_liabilities: {
      total: number;
    };
    total: number;
  };
  equity: {
    capital:               number;
    retained_earnings:     number;
    current_year_earnings: number;
    total:                 number;
  };
  total_liab_equity: number;
  balanced:          boolean;
}

export async function render(
  ctx:    LayoutContext,
  data:   BsData,
  period: { start: string; end: string } | null,
): Promise<void> {
  // Balance sheet uses as_of_date as the period descriptor
  const periodDisplay = period ?? (data.as_of_date ? { start: data.as_of_date, end: data.as_of_date } : undefined);
  const page = ctx.doc.addPage([595, 842]);
  let y = drawHeader(page, ctx, 'Balance Sheet', periodDisplay);

  const drawRow = (label: string, value: number | null, indent = 0, bold = false): void => {
    const font = bold ? ctx.fontBold : ctx.font;
    page.drawText(label, { x: 40 + indent * 12, y, size: 10, font, color: rgb(0.1, 0.1, 0.1) });
    if (value !== null) {
      const valStr = formatIDR(value);
      page.drawText(valStr, {
        x: 555 - ctx.font.widthOfTextAtSize(valStr, 10),
        y, size: 10, font, color: rgb(0.1, 0.1, 0.1),
      });
    }
    y -= 16;
  };

  const drawSectionHeader = (label: string): void => {
    page.drawText(label, { x: 40, y, size: 11, font: ctx.fontBold, color: rgb(0.15, 0.35, 0.65) });
    y -= 18;
  };

  // ── ASSETS ───────────────────────────────────────────────────────────────────
  drawSectionHeader('ASSETS');
  drawRow('Current Assets', null, 0, true);
  drawRow('Cash & Equivalents', data.assets.current_assets.cash,      1);
  drawRow('Accounts Receivable', data.assets.current_assets.ar,       1);
  drawRow('Inventory',           data.assets.current_assets.inventory, 1);
  drawRow('Total Current Assets', data.assets.current_assets.total,   0, true);
  y -= 4;

  drawRow('Non-Current Assets', null, 0, true);
  drawRow('Equipment',             data.assets.non_current_assets.equipment, 1);
  drawRow('Other',                 data.assets.non_current_assets.other,     1);
  drawRow('Total Non-Current Assets', data.assets.non_current_assets.total,  0, true);
  y -= 4;

  drawRow('TOTAL ASSETS', data.assets.total, 0, true);
  y -= 8;

  // ── LIABILITIES ──────────────────────────────────────────────────────────────
  drawSectionHeader('LIABILITIES');
  drawRow('Current Liabilities', null, 0, true);
  drawRow('Accounts Payable', data.liabilities.current_liabilities.ap,    1);
  drawRow('Other',            data.liabilities.current_liabilities.other, 1);
  drawRow('Total Current Liabilities', data.liabilities.current_liabilities.total, 0, true);
  y -= 4;

  drawRow('Non-Current Liabilities', null, 0, true);
  drawRow('Total Non-Current Liabilities', data.liabilities.non_current_liabilities.total, 1, true);
  y -= 4;

  drawRow('TOTAL LIABILITIES', data.liabilities.total, 0, true);
  y -= 8;

  // ── EQUITY ───────────────────────────────────────────────────────────────────
  drawSectionHeader('EQUITY');
  drawRow('Capital',               data.equity.capital,               1);
  drawRow('Retained Earnings',     data.equity.retained_earnings,     1);
  drawRow('Current Year Earnings', data.equity.current_year_earnings, 1);
  drawRow('TOTAL EQUITY',          data.equity.total,                 0, true);
  y -= 8;

  drawRow('TOTAL LIABILITIES & EQUITY', data.total_liab_equity, 0, true);
  y -= 8;

  // Balanced indicator
  const balanceStr = data.balanced ? 'Balanced ✓' : 'NOT BALANCED ✗';
  const balanceColor = data.balanced ? rgb(0, 0.5, 0) : rgb(0.8, 0, 0);
  page.drawText(balanceStr, {
    x: 555 - ctx.fontBold.widthOfTextAtSize(balanceStr, 10),
    y, size: 10, font: ctx.fontBold, color: balanceColor,
  });

  drawFooter(page, ctx, 1, 1);
}
