// Template reçu — ferme l'action S60 : rend promotions[] + totals.promotion_total.
import type { ReceiptPayload } from '@breakery/domain';
import type { PrinterLike } from './printerLike.js';

/** IDR : entier, séparateur de milliers '.', pas de décimales. */
export function money(n: number): string {
  return Math.round(n).toLocaleString('de-DE'); // de-DE = '.' milliers, format id-ID identique
}

const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash', card: 'Card', qris: 'QRIS', edc: 'EDC', transfer: 'Transfer', store_credit: 'Store credit',
};

export function renderReceipt(p: PrinterLike, r: ReceiptPayload): void {
  p.alignCenter();
  p.bold(true);
  p.setTextSize(1, 1);
  p.println(r.business.name);
  p.setTextNormal();
  p.bold(false);
  p.println(r.business.address);
  if (r.business.phone) p.println(r.business.phone);
  if (r.business.tax_id) p.println(`NPWP ${r.business.tax_id}`);
  p.drawLine();

  p.alignLeft();
  p.leftRight(`#${r.order.order_number}`, r.order.order_type === 'dine_in' ? 'Dine in' : 'Take out');
  p.leftRight(new Date(r.order.created_at).toLocaleString('en-GB'), r.order.cashier_name);
  if (r.customer) p.println(`Customer: ${r.customer.name}${r.customer.loyalty_tier ? ` (${r.customer.loyalty_tier})` : ''}`);
  p.drawLine();

  for (const item of r.items) {
    p.leftRight(`${item.quantity}x ${item.name}`, money(item.line_total));
    for (const mod of item.modifiers ?? []) {
      p.leftRight(`  + ${mod.label}`, money(mod.price_adjustment));
    }
  }
  p.drawLine();

  p.leftRight('Subtotal', money(r.totals.items_total));
  if (r.promotions && r.promotions.length > 0) {
    for (const promo of r.promotions) p.leftRight(promo.name, `-${money(promo.amount)}`);
    p.leftRight('Promotions', `-${money(r.totals.promotion_total ?? r.promotions.reduce((s, x) => s + x.amount, 0))}`);
  }
  if (r.totals.redemption_amount > 0) p.leftRight('Points redeemed', `-${money(r.totals.redemption_amount)}`);
  p.leftRight('Tax', money(r.totals.tax_amount));
  p.bold(true);
  p.leftRight('TOTAL', money(r.totals.total));
  p.bold(false);
  p.drawLine();

  p.leftRight(METHOD_LABELS[r.payment.method] ?? r.payment.method, money(r.payment.amount));
  if (r.payment.cash_received !== undefined) p.leftRight('Cash received', money(r.payment.cash_received));
  if (r.payment.change_given !== undefined) p.leftRight('Change', money(r.payment.change_given));

  if (r.loyalty) {
    p.drawLine();
    p.println(`Points earned: ${r.loyalty.points_earned}`);
    if (r.loyalty.balance_after !== undefined) p.println(`Points balance: ${r.loyalty.balance_after}`);
  }

  if (r.footer) {
    p.newLine();
    p.alignCenter();
    p.println(r.footer);
  }
  p.newLine();
  p.cut();
}
