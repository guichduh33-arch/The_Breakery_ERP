// apps/pos/src/features/cart/__tests__/print-paid-snapshot-waiter-copies.test.ts
//
// S1-22 — l'impression d'une commande payée avant tout envoi en cuisine
// (printPaidSnapshot) honore le nombre de copies du ticket serveur, comme les
// deux autres envois : N copies, 0 = aucun ticket serveur, 1 si le réglage manque.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { StationTicketPayload } from '@breakery/domain';
import type { PaymentAttempt } from '@/stores/paymentAttempt';
import { printPaidSnapshot } from '../hooks/printPaidSnapshot';

const mocks = vi.hoisted(() => ({ run: vi.fn(), copies: vi.fn() }));
vi.mock('@/services/print/printJobs', () => ({ runPrintJob: mocks.run }));
vi.mock('@/features/settings/hooks/useKotCopies', () => ({ getKotCopies: mocks.copies }));
vi.mock('../hooks/useStationMap', () => ({ getStationMap: () => Promise.resolve({ coffee: ['barista'] }) }));
vi.mock('../hooks/useStationPrinters', () => ({ getStationPrinters: vi.fn() }));
vi.mock('@/features/inbox/hooks/fetchOrderSnapshot', () => ({ fetchOrderSnapshot: vi.fn() }));

const ITEM = { id: 'l1', product_id: 'coffee', name: 'Latte', quantity: 1, unit_price: 30_000, modifiers: [] };
const SNAPSHOT = {
  version: 1,
  state: 'confirmed',
  result: { orderId: 'order-1', paidItems: [ITEM] },
  cart: { items: [ITEM], order_type: 'dine_in', tableNumber: '4' },
  tenders: [],
  context: { idempotencyKey: 'pay-1', printedItemIds: [] },
  customer: null,
  offline: false,
  taxRate: 0.1,
  taxInclusive: true,
} as unknown as PaymentAttempt;

const PRINTERS = new Map([
  ['barista', { ip_address: '192.168.1.32', port: 9100 }],
  ['waiter', { ip_address: '192.168.1.14', port: 9100 }],
]);

const waiterCalls = () => mocks.run.mock.calls.filter((call) => (call[0] as StationTicketPayload).role === 'waiter');

async function print() {
  return printPaidSnapshot(SNAPSHOT, '#0042', PRINTERS as never, new QueryClient(), 'Tester', () => true);
}

describe('printPaidSnapshot — waiter ticket copies (S1-22)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.run.mockResolvedValue({ success: true });
  });

  it('asks for the configured number of waiter copies', async () => {
    mocks.copies.mockResolvedValue({ barista: 1, kitchen: 1, display: 1, waiter: 2 });
    await print();
    expect(waiterCalls()).toHaveLength(1);
    expect(waiterCalls()[0]![2]).toBe(2);
    expect(waiterCalls()[0]![0]).toMatchObject({ kind: 'waiter', role: 'waiter', order_number: '#0042', table_number: '4' });
  });

  it('prints no waiter ticket when the setting is 0, the station ticket still prints', async () => {
    mocks.copies.mockResolvedValue({ barista: 1, kitchen: 1, display: 1, waiter: 0 });
    await print();
    expect(waiterCalls()).toHaveLength(0);
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect((mocks.run.mock.calls[0]![0] as StationTicketPayload).role).toBe('barista');
  });

  it('falls back to one waiter copy when the setting is missing', async () => {
    mocks.copies.mockResolvedValue({ barista: 1, kitchen: 1, display: 1 });
    await print();
    expect(waiterCalls()[0]![2]).toBe(1);
  });
});
