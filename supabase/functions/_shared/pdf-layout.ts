// supabase/functions/_shared/pdf-layout.ts
//
// S29 Wave 3.A.1 — header/footer + IDR formatter commun à tous les PDF templates.

import { PDFDocument, PDFFont, PDFImage, PDFPage, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1';

export interface BusinessInfo {
  name:     string;
  npwp?:    string;
  address?: string;
  logoUrl?: string;
}

export interface LayoutContext {
  doc:      PDFDocument;
  font:     PDFFont;
  fontBold: PDFFont;
  business: BusinessInfo;
  logo?:    PDFImage;
}

export async function initLayout(business: BusinessInfo): Promise<LayoutContext> {
  const doc      = await PDFDocument.create();
  const font     = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  // Brand logo (business_config.logo_url, bucket `branding`) — best-effort:
  // a missing/unreachable/unsupported logo must never break PDF generation.
  let logo: PDFImage | undefined;
  if (business.logoUrl) {
    try {
      const res = await fetch(business.logoUrl);
      if (res.ok) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        // Magic bytes: PNG = 89 50 4E 47, JPEG = FF D8.
        if (bytes[0] === 0x89 && bytes[1] === 0x50) {
          logo = await doc.embedPng(bytes);
        } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
          logo = await doc.embedJpg(bytes);
        }
      }
    } catch (err) {
      console.warn('[pdf-layout] logo fetch/embed failed, rendering text-only header', err);
    }
  }

  return { doc, font, fontBold, business, logo };
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

  // Brand logo — top-left, capped at 30pt tall; text block shifts right of it.
  let textX = 40;
  if (ctx.logo) {
    const scale = 30 / ctx.logo.height;
    const w = ctx.logo.width * scale;
    page.drawImage(ctx.logo, { x: 40, y: height - 68, width: w, height: 30 });
    textX = 40 + w + 10;
  }

  // Business name — top-left (right of the logo when present)
  page.drawText(ctx.business.name, {
    x: textX, y: height - 50, size: 14, font: ctx.fontBold, color: rgb(0.1, 0.1, 0.1),
  });
  if (ctx.business.npwp) {
    page.drawText(`NPWP: ${ctx.business.npwp}`, {
      x: textX, y: height - 65, size: 8, font: ctx.font, color: rgb(0.3, 0.3, 0.3),
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
