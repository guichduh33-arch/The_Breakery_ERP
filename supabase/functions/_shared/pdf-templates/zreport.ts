// supabase/functions/_shared/pdf-templates/zreport.ts
//
// S29 Wave 3.B.1 — Z-Report PDF template (legal Indonesia archive format).
// Layout: business header (name + NPWP + address) | shift period | cash drawer summary
//         | payment methods breakdown | sales/refunds/voids/expenses | top 10 products | signature box.

import { rgb } from 'https://esm.sh/pdf-lib@1.17.1';
import { drawFooter, drawHeader, formatIDR, type LayoutContext } from '../pdf-layout.ts';

export interface ZReportSnapshotData {
  // Snapshot shape from get_zreport_snapshot_v1 (which embeds the z_reports.snapshot JSONB)
  shift_id:               string;
  session_number?:        string | null;
  opened_at:              string;
  closed_at:              string | null;
  opened_by?:             string | null;
  closed_by?:             string | null;
  opening_cash:           number;
  closing_cash_expected:  number;
  closing_cash_counted:   number;
  cash_variance:          number;
  cash_in_total:          number;
  cash_out_total:         number;
  totals_by_payment_method: Record<string, number>;
  sales_total:            number;
  refunds_total:          number;
  voids_total:            number;
  expenses_cash_total:    number;
  top_products:           Array<{ product_id: string; product_name: string; qty: number; revenue: number }>;
  generated_at:           string;
  // S67 (12 D2.2/D2.3) — optional three-way reconciliation + denomination
  // breakdown. Snapshots created before S67 lack both keys entirely.
  reconciliation?: Record<'cash' | 'qris' | 'card', {
    expected: number | null;
    counted:  number | null;
    variance: number | null;
  }> | null;
  denominations?: Record<string, number> | null;
}

export interface ZReportEnvelope {
  id:               string;
  shift_id:         string;
  generated_at:     string;
  signed_at:        string | null;
  signed_by_name:   string | null;
  status:           'draft' | 'signed' | 'voided';
  snapshot:         ZReportSnapshotData;
}

export async function render(
  ctx: LayoutContext,
  envelope: ZReportEnvelope,
  _period: { start: string; end: string } | null,
): Promise<void> {
  const snap = envelope.snapshot;
  const page = ctx.doc.addPage([595, 842]);
  // "—" (U+2014) est encodable WinAnsi ; "→" (U+2192) ne l'est pas et faisait
  // crasher pdf-lib (`WinAnsi cannot encode`) — bug S29 jamais vu car le close
  // shift était inatteignable avant l'audit POS 2026-06-12 (lot 3).
  const periodLabel = `${snap.opened_at.slice(0, 16).replace('T', ' ')} — ${(snap.closed_at ?? '').slice(0, 16).replace('T', ' ')}`;
  let y = drawHeader(page, ctx, 'Z-Report (End-of-Shift)', undefined);

  // Subtitle : shift period
  page.drawText(`Shift period: ${periodLabel}`, { x: 40, y, size: 10, font: ctx.font, color: rgb(0.2, 0.2, 0.2) });
  y -= 14;
  if (snap.session_number) {
    page.drawText(`Session #: ${snap.session_number}`, { x: 40, y, size: 9, font: ctx.font, color: rgb(0.3, 0.3, 0.3) });
    y -= 14;
  }
  y -= 6;

  // Section title helper
  const sectionTitle = (label: string) => {
    page.drawText(label, { x: 40, y, size: 11, font: ctx.fontBold, color: rgb(0.1, 0.1, 0.1) });
    y -= 16;
  };

  // Labeled row helper (label on left, value right-aligned)
  const labeled = (label: string, value: number, indent = 0) => {
    page.drawText(label, { x: 40 + indent * 12, y, size: 9, font: ctx.font, color: rgb(0.2, 0.2, 0.2) });
    const v = formatIDR(value);
    page.drawText(v, { x: 555 - ctx.font.widthOfTextAtSize(v, 9), y, size: 9, font: ctx.font, color: rgb(0.2, 0.2, 0.2) });
    y -= 14;
  };

  // Cash Drawer section
  sectionTitle('Cash Drawer');
  labeled('Opening cash',            snap.opening_cash,           1);
  labeled('Cash in',                 snap.cash_in_total,          1);
  labeled('Cash out',                snap.cash_out_total,         1);
  labeled('Closing cash (expected)', snap.closing_cash_expected,  1);
  labeled('Closing cash (counted)',  snap.closing_cash_counted,   1);
  labeled('Variance',                snap.cash_variance,          1);
  y -= 6;

  // Payment methods section
  sectionTitle('Totals by payment method');
  const methods = Object.entries(snap.totals_by_payment_method || {});
  if (methods.length === 0) {
    page.drawText('(no completed payments)', { x: 52, y, size: 9, font: ctx.font, color: rgb(0.5, 0.5, 0.5) });
    y -= 14;
  } else {
    for (const [method, total] of methods) labeled(method, Number(total), 1);
  }
  y -= 6;

  // S67 (12 D2.2/D2.3) — three-way reconciliation + denomination grid.
  // Older snapshots (pre-S67) simply lack the keys: sections are omitted.
  if (snap.reconciliation) {
    sectionTitle('Reconciliation (counted vs expected)');
    for (const volet of ['cash', 'qris', 'card'] as const) {
      const r = snap.reconciliation[volet];
      if (!r || r.counted === null || r.counted === undefined) continue;
      labeled(`${volet} counted`,  Number(r.counted),  1);
      labeled(`${volet} expected`, Number(r.expected ?? 0), 1);
      labeled(`${volet} variance`, Number(r.variance ?? 0), 1);
    }
    y -= 6;
  }
  if (snap.denominations && Object.keys(snap.denominations).length > 0) {
    sectionTitle('Closing cash by denomination');
    for (const [face, qty] of Object.entries(snap.denominations)) {
      if (Number(qty) === 0) continue;
      labeled(`${formatIDR(Number(face))} x ${qty}`, Number(face) * Number(qty), 1);
    }
    y -= 6;
  }

  // Sales summary section
  sectionTitle('Sales summary');
  labeled('Sales total',        snap.sales_total,         1);
  labeled('Refunds total',      snap.refunds_total,       1);
  labeled('Voids total',        snap.voids_total,         1);
  labeled('Cash expenses paid', snap.expenses_cash_total, 1);
  y -= 6;

  // Top 10 products section
  sectionTitle('Top 10 products');
  page.drawText('Product', { x: 52,  y, size: 9, font: ctx.fontBold });
  page.drawText('Qty',     { x: 360, y, size: 9, font: ctx.fontBold });
  page.drawText('Revenue', { x: 500, y, size: 9, font: ctx.fontBold });
  y -= 14;
  for (const p of (snap.top_products ?? []).slice(0, 10)) {
    if (y < 180) break;
    page.drawText(p.product_name.slice(0, 50), { x: 52, y, size: 9, font: ctx.font });
    const qStr = String(p.qty);
    page.drawText(qStr, { x: 395 - ctx.font.widthOfTextAtSize(qStr, 9), y, size: 9, font: ctx.font });
    const rStr = formatIDR(p.revenue);
    page.drawText(rStr, { x: 555 - ctx.font.widthOfTextAtSize(rStr, 9), y, size: 9, font: ctx.font });
    y -= 13;
  }

  // Signature box at bottom (above footer)
  const sigY = 100;
  page.drawLine({ start: { x: 40, y: sigY + 30 }, end: { x: 555, y: sigY + 30 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
  page.drawText('Signed by:', { x: 40, y: sigY + 14, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  if (envelope.status === 'signed' && envelope.signed_by_name) {
    page.drawText(envelope.signed_by_name, { x: 100, y: sigY + 14, size: 9, font: ctx.font });
    page.drawText(`Date: ${(envelope.signed_at ?? '').slice(0, 16).replace('T', ' ')} WIB`, { x: 320, y: sigY + 14, size: 9, font: ctx.font });
  } else {
    page.drawText('_________________________________', { x: 100, y: sigY + 14, size: 9, font: ctx.font, color: rgb(0.5, 0.5, 0.5) });
    page.drawText('Date: ____________  Role: ____________', { x: 320, y: sigY + 14, size: 9, font: ctx.font, color: rgb(0.5, 0.5, 0.5) });
  }
  page.drawText(`Z-Report ID: ${envelope.id}`, { x: 40, y: sigY - 4, size: 7, font: ctx.font, color: rgb(0.5, 0.5, 0.5) });

  drawFooter(page, ctx, 1, 1);
}
