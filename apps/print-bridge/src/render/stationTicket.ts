// KOT station (kind 'prep') + ticket waiter consolidé (kind 'waiter', S-B1 Ph1 Bloc 1.4).
import type { StationTicketPayload } from '@breakery/domain';
import type { PrinterLike } from './printerLike.js';
import { money } from './receipt.js';

/** Le driver ne réduit pas sa largeur de retour à la ligne avec la police ×2. */
function printWrapped(p: PrinterLike, text: string, columns: number): void {
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    let remaining = Array.from(paragraph);
    while (remaining.length > columns) {
      const space = remaining.lastIndexOf(' ', columns);
      const end = space > 0 ? space : columns;
      p.println(remaining.slice(0, end).join(''));
      remaining = remaining.slice(end);
      if (remaining[0] === ' ') remaining = remaining.slice(1);
    }
    p.println(remaining.join(''));
  }
}

export function renderStationTicket(p: PrinterLike, t: StationTicketPayload): void {
  if (t.kind === 'shift_close') {
    p.alignCenter(); p.bold(true); p.println('SHIFT CLOSING REPORT');
    if (t.duplicate) p.println('*** DUPLICATE ***');
    p.bold(false); p.alignLeft(); p.println(`Shift ${t.order_number}`);
    p.println(new Date(t.created_at).toLocaleString('en-GB'));
    p.println(`Cashier: ${t.server_name}`); p.drawLine();
    for (const line of t.report_lines ?? []) p.leftRight(line.label, money(line.amount));
    p.drawLine(); p.println('Closed shift — saved report'); p.newLine(); p.cut();
    return;
  }
  const largeItems = t.kind === 'prep';
  const normalWidth = p.getWidth?.() ?? 48;
  const largeColumns = Number.isInteger(normalWidth) && normalWidth > 0
    ? Math.max(1, Math.floor(normalWidth / 2)) : 24;
  const printItem = (text: string) => {
    if (largeItems) printWrapped(p, text, largeColumns);
    else p.println(text);
  };
  p.alignCenter();
  p.bold(true);
  p.setTextSize(1, 1);
  p.println(t.role.toUpperCase());
  p.setTextNormal();
  if (t.duplicate === true) p.println('*** DUPLICATE ***');
  if (t.additional === true) {
    p.println('*** ADDITIONAL ORDER ***');
  }
  p.bold(false);
  p.drawLine();

  p.alignLeft();
  p.setTextSize(1, 1);
  printItem(`#${t.order_number}`);
  p.setTextNormal();
  if (t.table_number !== undefined) p.println(`Table ${t.table_number}`);
  p.leftRight(new Date(t.created_at).toLocaleTimeString('en-GB'), t.server_name);
  p.drawLine();

  if (largeItems) p.setTextSize(1, 1);
  for (const item of t.items) {
    p.bold(true);
    printItem(`${item.quantity}x ${item.name}`);
    p.bold(false);
    for (const mod of item.modifiers ?? []) printItem(`  + ${mod}`);
    if (item.note) printItem(`  ! ${item.note}`);
  }
  if (largeItems) p.setTextNormal();
  p.newLine();
  p.cut();
}
