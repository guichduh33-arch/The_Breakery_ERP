// supabase/functions/_shared/pdf-layout.ts
//
// S29 Wave 3.A.1 — header/footer + IDR formatter commun à tous les PDF templates.

import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1';

export interface BusinessInfo {
  name:     string;
  npwp?:    string;
  address?: string;
}

export interface LayoutContext {
  doc:      PDFDocument;
  font:     PDFFont;
  fontBold: PDFFont;
  business: BusinessInfo;
}

export async function initLayout(business: BusinessInfo): Promise<LayoutContext> {
  const doc      = await PDFDocument.create();
  const font     = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  return { doc, font, fontBold, business };
}

/**
 * Draw page header (business name + title + optional period) and a separator line.
 * Returns the y coordinate where content should start (below the separator).
 */
export function drawHeader(
  page:   PDFPage,
  ctx:    LayoutContext,
  title:  string,
  period?: { start: string; end: string },
): number {
  const { width, height } = page.getSize();

  // Business name — top-left
  page.drawText(ctx.business.name, {
    x: 40, y: height - 50, size: 14, font: ctx.fontBold, color: rgb(0.1, 0.1, 0.1),
  });
  if (ctx.business.npwp) {
    page.drawText(`NPWP: ${ctx.business.npwp}`, {
      x: 40, y: height - 65, size: 8, font: ctx.font, color: rgb(0.3, 0.3, 0.3),
    });
  }

  // Report title — top-right
  page.drawText(title, {
    x: width - 40 - ctx.fontBold.widthOfTextAtSize(title, 16),
    y: height - 50, size: 16, font: ctx.fontBold, color: rgb(0.1, 0.1, 0.1),
  });
  if (period) {
    const periodStr = `${period.start} — ${period.end}`;
    page.drawText(periodStr, {
      x: width - 40 - ctx.font.widthOfTextAtSize(periodStr, 10),
      y: height - 65, size: 10, font: ctx.font, color: rgb(0.3, 0.3, 0.3),
    });
  }

  // Separator line
  page.drawLine({
    start: { x: 40, y: height - 80 },
    end:   { x: width - 40, y: height - 80 },
    thickness: 0.5,
    color: rgb(0.7, 0.7, 0.7),
  });

  return height - 100;
}

/**
 * Draw page footer with generation timestamp (WIB) and page counter.
 */
export function drawFooter(
  page:       PDFPage,
  ctx:        LayoutContext,
  pageNum:    number,
  totalPages: number,
): void {
  const { width } = page.getSize();

  const generated = `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} WIB`;
  page.drawText(generated, {
    x: 40, y: 30, size: 8, font: ctx.font, color: rgb(0.5, 0.5, 0.5),
  });

  const pageStr = `Page ${pageNum} / ${totalPages}`;
  page.drawText(pageStr, {
    x: width - 40 - ctx.font.widthOfTextAtSize(pageStr, 8),
    y: 30, size: 8, font: ctx.font, color: rgb(0.5, 0.5, 0.5),
  });
}

/** Format an integer rupiah value (stored as integer cents/IDR). Rounds to nearest 100. */
export function formatIDR(value: number, _locale = 'id-ID'): string {
  if (!Number.isFinite(value)) return '';
  return new Intl.NumberFormat('id-ID', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(value / 100) * 100);
}

/** Generic number formatter. */
export function formatNumber(value: number, _locale = 'id-ID'): string {
  if (!Number.isFinite(value)) return '';
  return new Intl.NumberFormat('id-ID').format(value);
}

/** Format a ratio (0–1) as a percentage string, e.g. 0.1234 → "12.34%". */
export function formatPct(value: number): string {
  if (!Number.isFinite(value)) return '';
  return `${(value * 100).toFixed(2)}%`;
}
