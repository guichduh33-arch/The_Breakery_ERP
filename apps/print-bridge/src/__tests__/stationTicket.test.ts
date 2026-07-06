import { describe, it, expect } from 'vitest';
import type { StationTicketPayload } from '@breakery/domain';
import { renderStationTicket } from '../render/stationTicket.js';
import { makeFake } from './receipt.test.js';

const BASE: StationTicketPayload = {
  kind: 'prep',
  role: 'kitchen',
  order_number: 'A-042',
  table_number: '5',
  created_at: '2026-07-06T09:30:00Z',
  server_name: 'Ayu',
  items: [
    { name: 'Croque Monsieur', quantity: 2, modifiers: ['No onions'], note: 'allergy: nuts' },
    { name: 'Omelette', quantity: 1 },
  ],
};

describe('renderStationTicket', () => {
  it('renders station header, order, table, items with modifiers and notes', () => {
    const { p, log } = makeFake();
    renderStationTicket(p, BASE);
    const flat = log.join('\n');
    expect(flat).toContain('KITCHEN');
    expect(flat).toContain('#A-042');
    expect(flat).toContain('Table 5');
    expect(flat).toContain('2x Croque Monsieur');
    expect(flat).toContain('  + No onions');
    expect(flat).toContain('  ! allergy: nuts');
    expect(log[log.length - 1]).toBe('<cut>');
  });

  it('renders the ADDITIONAL ORDER banner when additional=true', () => {
    const { p, log } = makeFake();
    renderStationTicket(p, { ...BASE, additional: true });
    expect(log.join('\n')).toContain('*** ADDITIONAL ORDER ***');
  });

  it('waiter ticket shows WAITER header, no table line when absent', () => {
    const { p, log } = makeFake();
    const { table_number: _table_number, ...baseWithoutTable } = BASE;
    renderStationTicket(p, { ...baseWithoutTable, kind: 'waiter', role: 'waiter' });
    const flat = log.join('\n');
    expect(flat).toContain('WAITER');
    expect(flat).not.toContain('Table');
  });
});
