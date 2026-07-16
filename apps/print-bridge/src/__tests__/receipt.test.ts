import { describe, it, expect } from 'vitest';
import type { ReceiptPayload } from '@breakery/domain';
import type { PrinterLike } from '../render/printerLike.js';
import { renderReceipt, money } from '../render/receipt.js';

export function makeFake(): { p: PrinterLike; log: string[] } {
  const log: string[] = [];
  const p: PrinterLike = {
    alignCenter: () => log.push('<center>'),
    alignLeft: () => log.push('<left>'),
    bold: (on) => log.push(on ? '<b>' : '</b>'),
    setTextSize: (h, w) => log.push(`<size ${h}x${w}>`),
    setTextNormal: () => log.push('<normal>'),
    println: (t) => log.push(t),
    newLine: () => log.push(''),
    drawLine: () => log.push('--------'),
    leftRight: (l, r) => log.push(`${l} | ${r}`),
    cut: () => log.push('<cut>'),
  };
  return { p, log };
}

const BASE: ReceiptPayload = {
  business: { name: 'The Breakery', address: 'Jl. Contoh 1' },
  order: { order_number: 'A-042', created_at: '2026-07-06T09:30:00Z', cashier_name: 'Ayu', order_type: 'take_out' },
  items: [
    { name: 'Croissant', quantity: 2, unit_price: 15000, line_total: 30000,
      modifiers: [{ label: 'Extra butter', price_adjustment: 2000 }] },
  ],
  totals: { items_total: 32000, redemption_amount: 0, total: 32000, tax_amount: 3200 },
  payment: { method: 'cash', amount: 50000, cash_received: 50000, change_given: 18000 },
};

describe('money', () => {
  it('formats IDR with thousand separators, no decimals', () => {
    expect(money(32000)).toBe('32.000');
    expect(money(1250500)).toBe('1.250.500');
  });
});

describe('renderReceipt', () => {
  it('renders business, items, modifiers, totals, payment and cuts', () => {
    const { p, log } = makeFake();
    renderReceipt(p, BASE);
    const flat = log.join('\n');
    expect(flat).toContain('The Breakery');
    expect(flat).toContain('2x Croissant | 30.000');
    expect(flat).toContain('  + Extra butter | 2.000');
    expect(flat).toContain('TOTAL | 32.000');
    expect(flat).toContain('Cash | 50.000');
    expect(flat).toContain('Change | 18.000');
    expect(log[log.length - 1]).toBe('<cut>');
  });

  it('renders named promotion lines + promotion_total (S60)', () => {
    const { p, log } = makeFake();
    renderReceipt(p, {
      ...BASE,
      totals: { ...BASE.totals, promotion_total: 5000 },
      promotions: [{ name: 'Happy Hour -10%', amount: 5000 }],
    });
    const flat = log.join('\n');
    expect(flat).toContain('Happy Hour -10% | -5.000');
    expect(flat).toContain('Promotions | -5.000');
  });

  it('omits promo/loyalty/footer blocks when absent', () => {
    const { p, log } = makeFake();
    renderReceipt(p, BASE);
    const flat = log.join('\n');
    expect(flat).not.toContain('Promotions |');
    expect(flat).not.toContain('Points');
  });

  // Settings §6.A — receipt template applied by the POS (header/footer/QR).
  it('renders template header lines under the identity block and multi-line footer', () => {
    const { p, log } = makeFake();
    renderReceipt(p, {
      ...BASE,
      footer: 'Thank you!\nSee you tomorrow',
      template: { header: 'Lombok, Indonesia\nOpen 7am — 7pm' },
    });
    const flat = log.join('\n');
    const headerIdx = log.indexOf('Lombok, Indonesia');
    expect(headerIdx).toBeGreaterThan(log.indexOf('The Breakery'));
    expect(headerIdx).toBeLessThan(log.indexOf('--------'));
    expect(flat).toContain('Open 7am — 7pm');
    expect(flat).toContain('Thank you!');
    expect(flat).toContain('See you tomorrow');
  });

  it('prints a QR of the order number when template.show_qr is on and the printer supports it', () => {
    const { p, log } = makeFake();
    const qr: string[] = [];
    (p as PrinterLike).printQR = (data: string) => qr.push(data);
    renderReceipt(p, { ...BASE, template: { show_qr: true } });
    expect(qr).toEqual(['A-042']);
    expect(log[log.length - 1]).toBe('<cut>');
  });

  it('skips the QR silently when the printer has no printQR (older mocks/hardware)', () => {
    const { p, log } = makeFake();
    renderReceipt(p, { ...BASE, template: { show_qr: true } });
    expect(log[log.length - 1]).toBe('<cut>');
  });
});
