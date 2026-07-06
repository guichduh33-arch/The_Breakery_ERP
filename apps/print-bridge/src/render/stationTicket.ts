// KOT station (kind 'prep') + ticket waiter consolidé (kind 'waiter', S-B1 Ph1 Bloc 1.4).
import type { StationTicketPayload } from '@breakery/domain';
import type { PrinterLike } from './printerLike.js';

export function renderStationTicket(p: PrinterLike, t: StationTicketPayload): void {
  p.alignCenter();
  p.bold(true);
  p.setTextSize(1, 1);
  p.println(t.role.toUpperCase());
  p.setTextNormal();
  if (t.additional === true) {
    p.println('*** ADDITIONAL ORDER ***');
  }
  p.bold(false);
  p.drawLine();

  p.alignLeft();
  p.setTextSize(1, 1);
  p.println(`#${t.order_number}`);
  p.setTextNormal();
  if (t.table_number !== undefined) p.println(`Table ${t.table_number}`);
  p.leftRight(new Date(t.created_at).toLocaleTimeString('en-GB'), t.server_name);
  p.drawLine();

  for (const item of t.items) {
    p.bold(true);
    p.println(`${item.quantity}x ${item.name}`);
    p.bold(false);
    for (const mod of item.modifiers ?? []) p.println(`  + ${mod}`);
    if (item.note) p.println(`  ! ${item.note}`);
  }
  p.newLine();
  p.cut();
}
