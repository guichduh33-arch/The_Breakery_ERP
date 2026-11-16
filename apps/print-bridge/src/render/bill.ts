// S1-21 — addition chiffrée (`kind: 'bill'`), imprimée AVANT paiement.
// Les montants arrivent calculés par le POS (builders du domaine) : ce rendu
// ne recalcule rien. Un POS plus ancien envoie des lignes sans `line_total` et
// sans `discount` : la ligne sort alors sans prix, comme avant.
import type { StationTicketPayload } from '@breakery/domain';
import type { PrinterLike } from './printerLike.js';
import { money } from './receipt.js';

export function renderBill(p: PrinterLike, t: StationTicketPayload): void {
  p.alignCenter();
  p.bold(true);
  p.setTextSize(1, 1);
  p.println('BILL');
  p.setTextNormal();
  p.bold(false);
  if (t.duplicate === true) p.println('*** DUPLICATE ***');
  p.println('This is not a receipt');
  p.drawLine();

  p.alignLeft();
  p.bold(true);
  p.println(t.order_number);
  p.bold(false);
  if (t.table_number !== undefined && t.order_number !== `Table ${t.table_number}`) {
    p.println(`Table ${t.table_number}`);
  }
  p.println(new Date(t.created_at).toLocaleString('en-GB'));
  p.println(`Served by: ${t.server_name}`);
  p.drawLine();

  for (const item of t.items) {
    const label = `${item.quantity}x ${item.name}`;
    if (item.line_total !== undefined) p.leftRight(label, money(item.line_total));
    else p.println(label);
    for (const mod of item.modifiers ?? []) p.println(`  + ${mod}`);
    if (item.note) p.println(`  ! ${item.note}`);
  }

  const totals = t.totals;
  if (totals) {
    p.drawLine();
    p.leftRight('Subtotal', money(totals.subtotal));
    if ((totals.discount ?? 0) > 0) p.leftRight('Discount', `-${money(totals.discount ?? 0)}`);
    p.leftRight(totals.tax_inclusive === true ? 'Tax (incl.)' : 'Tax', money(totals.tax));
    p.bold(true);
    p.leftRight('TOTAL', money(totals.total));
    p.bold(false);
  }
  p.newLine();
  p.cut();
}
