// Journal de contrôle : heure métier, descriptions complètes et provenance.
// La pagination suit la hauteur réelle des entrées, sans couper les motifs.
import { rgb, type PDFPage } from 'https://esm.sh/pdf-lib@1.17.1';
import { drawFooter, drawHeader, type LayoutContext } from '../pdf-layout.ts';

export interface AuditRow {
  id:          string;
  created_at:  string;
  action:      string;
  entity_type: string;
  actor_id:    string | null;
  actor_name?: string | null;
  description?: string;
  entity_label?: string;
  entity_id?: string | null;
  source_label?: string;
  actor_context?: string;
  review_cue?: string | null;
}

export type AuditData = AuditRow[];

const COL_TS     = 40;
const COL_ACTION = 150;
const COL_ENTITY = 405;
const COL_ACTOR  = 475;
const LINE_H = 11;

function drawTableHeader(page: PDFPage, ctx: LayoutContext, y: number): number {
  page.drawText('Time (WITA)', { x: COL_TS, y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Event / review cue', { x: COL_ACTION, y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Record', { x: COL_ENTITY, y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText('Account', { x: COL_ACTOR, y, size: 9, font: ctx.fontBold, color: rgb(0.2, 0.2, 0.2) });
  y -= 4;
  page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 0.3, color: rgb(0.7, 0.7, 0.7) });
  return y - 10;
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
  const characters = new Set(ctx.font.getCharacterSet());
  // Helvetica ne couvre pas tout Unicode. Une forme échappée conserve la
  // référence du caractère et permet de générer le PDF. Le CSV garde le texte.
  const pdfText = (text: string): string => Array.from(text, (character) => {
    const code = character.codePointAt(0)!;
    return characters.has(code) ? character : `[U+${code.toString(16).toUpperCase()}]`;
  }).join('');
  const pages: PDFPage[] = [];
  let rowIndex = 0;
  let page!: PDFPage;
  let y = 0;

  // Mesurer le texte au lieu de couper la raison ou le montant après 30 caractères.
  const wrap = (text: string, width: number): string[] => {
    const lines: string[] = [];
    for (const paragraph of pdfText(text).split(/\r?\n/)) {
      let line = '';
      for (const character of paragraph) {
        if (line && ctx.font.widthOfTextAtSize(line + character, 8) > width) {
          const space = line.lastIndexOf(' ');
          if (space > 0) { lines.push(line.slice(0, space)); line = line.slice(space + 1); }
          else { lines.push(line); line = ''; }
        }
        line += character;
      }
      lines.push(line);
    }
    return lines;
  };

  const timestamp = (value: string): string => {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return value;
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Makassar', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
  };

  const newPage = (): void => {
    page = ctx.doc.addPage([595, 842]);
    pages.push(page);
    y = drawHeader(page, ctx, 'Activity & Control Log', period ?? undefined);
    page.drawText('Loaded entries only. Review cues prompt checks; they do not prove fraud.', {
      x: 40, y, size: 8, font: ctx.font, color: rgb(0.3, 0.3, 0.3),
    });
    y -= 16;
    y = drawTableHeader(page, ctx, y);
  };

  newPage();

  for (const row of data) {
    const columns = [
      { x: COL_TS, lines: wrap(timestamp(row.created_at), 100) },
      { x: COL_ACTION, lines: wrap([row.description ?? row.action, row.source_label, `Event: ${row.id}`,
        row.review_cue ? `Review: ${row.review_cue}` : null].filter(Boolean).join('\n'), 245) },
      { x: COL_ENTITY, lines: wrap([row.entity_label ?? row.entity_type,
        row.entity_id ? shortId(row.entity_id) : null].filter(Boolean).join('\n'), 60) },
      { x: COL_ACTOR, lines: wrap([row.actor_name ?? shortId(row.actor_id), row.actor_context].filter(Boolean).join('\n'), 80) },
    ];
    const lineCount = Math.max(...columns.map(column => column.lines.length));
    // Une entrée exceptionnellement longue peut continuer sur la page suivante.
    for (let lineIndex = 0; lineIndex < lineCount; lineIndex++) {
      if (y < 80) newPage();
      const bg = rowIndex % 2 === 0 ? rgb(0.97, 0.97, 0.97) : rgb(1, 1, 1);
      page.drawRectangle({ x: 40, y: y - 2, width: 515, height: LINE_H, color: bg });
      for (const column of columns) {
        const line = column.lines[lineIndex];
        if (line) page.drawText(line, { x: column.x, y, size: 8, font: ctx.font, color: rgb(0.2, 0.2, 0.2) });
      }
      y -= LINE_H;
    }
    y -= 5;
    rowIndex++;
  }

  pages.forEach((item, index) => drawFooter(item, ctx, index + 1, pages.length));
}
