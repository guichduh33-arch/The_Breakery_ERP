// supabase/functions/_shared/pdf-templates/audit.ts
// S29 Wave 3.A.2 — Audit Log PDF template
// Table: Timestamp | Action | Entity | Actor   (multi-page, ~30 rows/page)
import { rgb } from 'https://esm.sh/pdf-lib@1.17.1';
import { drawFooter, drawHeader, type LayoutContext } from '../pdf-layout.ts';

export interface AuditRow {
  id:          string;
  created_at:  string;
  action:      string;
  entity_type: string;
  actor_id:    string | null;
}

export type AuditData = AuditRow[];

const COL_TS     = 40;
const COL_ACTION = 160;
const COL_ENTITY = 310;
const COL_ACTOR  = 420;
const ROWS_PER_PAGE = 30;
const ROW_H     = 15;

function drawTableHeader(page: ReturnType<typeof Object.assign>, ctx: LayoutContext, y: number): number {
  page.drawText('Timestamp', { x: COL_TS,     y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Action',    { x: COL_ACTION, y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Entity',    { x: COL_ENTITY, y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Actor',     { x: COL_ACTOR,  y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  y -= 4;
  page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 0.3, color: rgb(0.7, 0.7, 0.7) });
  return y - 10;
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen - 1) + '…' : text;
}

/** Shorten UUID to last 8 chars for display readability. */
function shortId(id: string | null): string {
  if (!id) return '—';
  return '…' + id.slice(-8);
}

export async function render(
  ctx:    LayoutContext,
  data:   AuditData,
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
    y = drawHeader(page, ctx, 'Audit Log', period ?? undefined);
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

    // Format timestamp: "2026-05-24 14:35" — drop seconds + T
    const ts = row.created_at.length >= 16
      ? row.created_at.slice(0, 16).replace('T', ' ')
      : row.created_at;

    page.drawText(ts,                              { x: COL_TS,     y, size: 8, font: ctx.font, color: rgb(0.3, 0.3, 0.3) });
    page.drawText(truncate(row.action, 18),        { x: COL_ACTION, y, size: 8, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(truncate(row.entity_type, 15),   { x: COL_ENTITY, y, size: 8, font: ctx.font, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(shortId(row.actor_id),           { x: COL_ACTOR,  y, size: 8, font: ctx.font, color: rgb(0.4, 0.4, 0.4) });

    y -= ROW_H;
    rowIndex++;
  }

  drawFooter(page, ctx, pageNum, totalPages);
}
