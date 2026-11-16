import { describe, it, expect } from 'vitest';
import type { StationTicketPayload } from '@breakery/domain';
import { renderStationTicket } from '../render/stationTicket.js';
import { makeFake } from './receipt.test.js';

// S1-21 — addition chiffrée avant paiement.
const BILL: StationTicketPayload = {
  kind: 'bill',
  role: 'waiter',
  order_number: 'Order T1-0042',
  table_number: '7',
  created_at: '2026-11-09T10:00:00Z',
  server_name: 'Ayu',
  items: [
    { name: 'Latte', quantity: 1, line_total: 35_000, modifiers: ['Oat milk'] },
    { name: 'Breakfast combo', quantity: 2, line_total: 134_000, modifiers: ['Coffee', 'Coffee: Large'] },
  ],
  totals: { subtotal: 169_000, discount: 17_000, tax: 15_200, tax_inclusive: false, total: 167_200 },
};

function render(t: StationTicketPayload): string[] {
  const { p, log } = makeFake();
  renderStationTicket(p, t);
  return log;
}

describe('renderStationTicket — bill', () => {
  it('prints the header, the order label without a hash and the table', () => {
    const log = render(BILL);
    expect(log).toContain('BILL');
    expect(log).toContain('This is not a receipt');
    expect(log).toContain('Order T1-0042');
    expect(log).toContain('Table 7');
    expect(log).toContain('Served by: Ayu');
    expect(log.join('\n')).not.toContain('#');
    expect(log.join('\n')).not.toContain('WAITER');
    expect(log).toContain(new Date(BILL.created_at).toLocaleString('en-GB'));
  });

  it('prints every line with its amount and modifiers below it', () => {
    const log = render(BILL);
    const latte = log.indexOf('1x Latte | 35.000');
    expect(latte).toBeGreaterThan(-1);
    expect(log[latte + 1]).toBe('  + Oat milk');
    const combo = log.indexOf('2x Breakfast combo | 134.000');
    expect(log.slice(combo + 1, combo + 3)).toEqual(['  + Coffee', '  + Coffee: Large']);
  });

  it('prints subtotal, discount, exclusive tax and a bold total', () => {
    const log = render(BILL);
    expect(log).toContain('Subtotal | 169.000');
    expect(log).toContain('Discount | -17.000');
    expect(log).toContain('Tax | 15.200');
    const total = log.indexOf('TOTAL | 167.200');
    expect(log[total - 1]).toBe('<b>');
    expect(log[total + 1]).toBe('</b>');
    expect(log.at(-1)).toBe('<cut>');
  });

  it('labels inclusive tax and hides a zero discount', () => {
    const log = render({ ...BILL, totals: { subtotal: 169_000, tax: 15_400, tax_inclusive: true, total: 169_000 } });
    expect(log).toContain('Tax (incl.) | 15.400');
    expect(log.some((line) => line.startsWith('Discount'))).toBe(false);
  });

  it('does not repeat the table when it is already the label', () => {
    const log = render({ ...BILL, order_number: 'Table 7' });
    expect(log.filter((line) => line === 'Table 7')).toHaveLength(1);
  });

  it('still prints a bill from an older POS without line prices', () => {
    const log = render({ ...BILL, order_number: 'Walk-in', items: [{ name: 'Latte', quantity: 1 }],
      totals: { subtotal: 35_000, tax: 3_200, total: 35_000 } });
    expect(log).toContain('1x Latte');
    expect(log).toContain('Tax | 3.200');
    expect(log).toContain('TOTAL | 35.000');
  });
});
