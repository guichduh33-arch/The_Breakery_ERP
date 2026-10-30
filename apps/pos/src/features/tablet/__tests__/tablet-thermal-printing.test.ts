import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { TabletCart, StationTicketPayload } from '@breakery/domain';
import { printTabletTickets } from '../hooks/printTabletTickets';
import { usePrintJobs } from '@/services/print/printJobs';
import { installPrintLocks } from '@/services/print/__tests__/printBrowser';
const mocks = vi.hoisted(() => ({ send: vi.fn(), stations: vi.fn(), printers: vi.fn(), copies: vi.fn() }));
vi.mock('@/services/print/printService', () => ({ printStationTicket: mocks.send }));
vi.mock('@/features/cart/hooks/useStationMap', () => ({ getStationMap: mocks.stations, STATION_MAP_KEY: ['station-map'] }));
vi.mock('@/features/cart/hooks/useStationPrinters', () => ({ getStationPrinters: mocks.printers, STATION_PRINTERS_KEY: ['station-printers'] }));
vi.mock('@/features/settings/hooks/useKotCopies', () => ({ getKotCopies: mocks.copies, KOT_COPIES_KEY: ['business-config', 'kot-copies'] }));
const cart: TabletCart = { orderType: 'take_out', tableNumber: '7', notes: 'Allergy', items: [
  { id: 'l1', product_id: 'coffee', name: 'Coffee', quantity: 2, unit_price: 10000,
    modifiers: [{ option_label: 'Oat milk', price_adjustment: 1000, group_name: 'Milk' }] },
] };
beforeEach(() => {
  vi.resetAllMocks(); usePrintJobs.setState({ jobs: [] });
  installPrintLocks();
  mocks.stations.mockResolvedValue({ coffee: ['kitchen', 'barista'] });
  mocks.printers.mockResolvedValue(new Map([['kitchen', { ip_address: '192.168.1.13', port: 9100 }],
    ['barista', { ip_address: '192.168.1.32', port: 9100 }]]));
  mocks.copies.mockResolvedValue({ kitchen: 1, barista: 1, display: 1 });
  mocks.send.mockResolvedValue({ success: true });
});
describe('tablet thermal tickets', () => {
  it('prints offline from cached routing and configuration without requesting the cloud', async () => {
    const qc = new QueryClient();
    qc.setQueryData(['station-map'], { coffee: ['kitchen'] });
    qc.setQueryData(['station-printers'], new Map([['kitchen', { ip_address: '192.168.1.13', port: 9100 }]]));
    qc.setQueryData(['business-config', 'kot-copies'], { kitchen: 1, barista: 1, display: 1 });
    expect(await printTabletTickets(qc, cart, 'offline-1', 'L-1', 'Waiter', false, true)).toBe(true);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.stations).not.toHaveBeenCalled();
    expect(mocks.printers).not.toHaveBeenCalled();
    expect(mocks.copies).not.toHaveBeenCalled();
  });
  it('reports missing offline configuration without waiting for the cloud', async () => {
    expect(await printTabletTickets(new QueryClient(), cart, 'offline-2', 'L-2', 'Waiter', false, true)).toBe(false);
    expect(mocks.stations).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('routes all stations, preserves notes and suppresses duplicate confirmation retries', async () => {
    const qc = new QueryClient();
    expect(await printTabletTickets(qc, cart, 'send-1', 'T1-7', 'Waiter', true)).toBe(true);
    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(mocks.send.mock.calls[0]?.[1]).toMatchObject({ additional: true, order_number: 'T1-7',
      table_number: '7', items: [{ quantity: 2, note: 'Allergy', modifiers: ['Oat milk'] }] });
    await usePrintJobs.persist.rehydrate();
    expect(await printTabletTickets(qc, cart, 'send-1', 'T1-7', 'Waiter', true)).toBe(true);
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });
  it('keeps missing-printer and lost-acknowledgement jobs for explicit recovery', async () => {
    mocks.printers.mockResolvedValue(new Map());
    expect(await printTabletTickets(new QueryClient(), cart, 'send-2', 'L-2', 'Waiter', false)).toBe(false);
    expect(usePrintJobs.getState().jobs).toHaveLength(2);
    expect(mocks.send).not.toHaveBeenCalled();
    mocks.printers.mockResolvedValue(new Map([['kitchen', { ip_address: '192.168.1.13', port: 9100 }]]));
    await printTabletTickets(new QueryClient(), cart, 'send-2', 'L-2', 'Waiter', false);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('reports unrouted items instead of claiming kitchen delivery', async () => {
    mocks.stations.mockResolvedValue({ coffee: [] });
    const failure = vi.fn();
    const qc = new QueryClient();
    expect(await printTabletTickets(qc, cart, 'send-3', 'L-3', 'Waiter', false, false, failure)).toBe(false);
    expect(mocks.stations).toHaveBeenCalledWith(qc, true);
    expect(failure).toHaveBeenCalledWith('Kitchen routing missing for saved order items');
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('identifies a preparation failure without claiming a printer job exists', async () => {
    mocks.stations.mockRejectedValue(new Error('unavailable'));
    const failure = vi.fn();
    expect(await printTabletTickets(new QueryClient(), cart, 'send-failed', 'T-9', 'Waiter', false, false, failure)).toBe(false);
    expect(failure).toHaveBeenCalledWith('Kitchen routing unavailable');
    expect(usePrintJobs.getState().jobs).toHaveLength(0);
  });
  it('respects stations deliberately configured without paper', async () => {
    mocks.copies.mockResolvedValue({ kitchen: 0, barista: 2, display: 1 });
    expect(await printTabletTickets(new QueryClient(), cart, 'send-4', 'T1-8', 'Waiter', false)).toBe(true);
    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(mocks.send.mock.calls.every((call) => (call[1] as StationTicketPayload).role === 'barista')).toBe(true);
  });
  it('sends each station its items and one complete waiter ticket without replaying confirmed jobs', async () => {
    const mixed: TabletCart = { ...cart, items: [cart.items[0]!,
      { ...cart.items[0]!, id: 'l2', product_id: 'food', name: 'Sandwich', quantity: 1, modifiers: [] },
      { ...cart.items[0]!, id: 'l3', product_id: 'cake', name: 'Cake', quantity: 1, modifiers: [] },
      { ...cart.items[0]!, id: 'cancelled', is_cancelled: true },
    ] };
    mocks.stations.mockResolvedValue({ coffee: ['barista'], food: ['kitchen'], cake: ['display'] });
    mocks.printers.mockResolvedValue(new Map([
      ['barista', { ip_address: '192.168.1.32', port: 9100 }],
      ['kitchen', { ip_address: '192.168.1.13', port: 9100 }],
      ['display', { ip_address: '192.168.1.15', port: 9100 }],
      ['waiter', { ip_address: '192.168.1.14', port: 9100 }],
    ]));
    const qc = new QueryClient();
    expect(await printTabletTickets(qc, mixed, 'mixed-1', 'T1-10', 'Made', true)).toBe(true);
    for (const [role, name] of [['barista', 'Coffee'], ['kitchen', 'Sandwich'], ['display', 'Cake']]) {
      const calls = mocks.send.mock.calls.filter((call) => (call[1] as StationTicketPayload).role === role);
      expect(calls).toHaveLength(1);
      expect((calls[0]![1] as StationTicketPayload).items.map((item) => item.name)).toEqual([name]);
    }
    const waiter = mocks.send.mock.calls.filter((call) => (call[1] as StationTicketPayload).role === 'waiter');
    expect(waiter).toHaveLength(1);
    expect(waiter[0]![0]).toEqual({ ip_address: '192.168.1.14', port: 9100 });
    expect(waiter[0]![1]).toMatchObject({ kind: 'waiter', additional: true, table_number: '7',
      order_number: 'T1-10', server_name: 'Made', items: [
        { name: 'Coffee', quantity: 2, note: 'Allergy', modifiers: ['Oat milk'] },
        { name: 'Sandwich', quantity: 1 }, { name: 'Cake', quantity: 1 },
      ] });
    await usePrintJobs.persist.rehydrate();
    expect(await printTabletTickets(qc, mixed, 'mixed-1', 'T1-10', 'Made', true)).toBe(true);
    expect(mocks.send).toHaveBeenCalledTimes(4);
  });
  it('prints the offline waiter recap even when prep copies are zero', async () => {
    const qc = new QueryClient();
    qc.setQueryData(['station-map'], { coffee: ['kitchen'] });
    qc.setQueryData(['station-printers'], new Map([['waiter', { ip_address: '192.168.1.14', port: 9100 }]]));
    qc.setQueryData(['business-config', 'kot-copies'], { kitchen: 0, barista: 0, display: 0 });
    expect(await printTabletTickets(qc, cart, 'offline-waiter', 'L-10', 'Made', false, true)).toBe(true);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send.mock.calls[0]![1]).toMatchObject({ kind: 'waiter', role: 'waiter', order_number: 'L-10' });
    expect(mocks.stations).not.toHaveBeenCalled();
    expect(mocks.printers).not.toHaveBeenCalled();
    expect(mocks.copies).not.toHaveBeenCalled();
  });
  it('retains a failed waiter job and does not automatically resend it or confirmed prep tickets', async () => {
    mocks.stations.mockResolvedValue({ coffee: ['kitchen'] });
    mocks.printers.mockResolvedValue(new Map([
      ['kitchen', { ip_address: '192.168.1.13', port: 9100 }],
      ['waiter', { ip_address: '192.168.1.14', port: 9100 }],
    ]));
    mocks.send.mockImplementation((_printer, payload: StationTicketPayload) => Promise.resolve(
      payload.role === 'waiter' ? { success: false, error: 'Lost acknowledgement' } : { success: true }));
    const failure = vi.fn();
    const qc = new QueryClient();
    expect(await printTabletTickets(qc, cart, 'waiter-failed', 'T1-11', 'Made', false, false, failure)).toBe(false);
    expect(failure).toHaveBeenCalledWith('Check the saved print job in Printing');
    expect(usePrintJobs.getState().jobs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'tablet:waiter-failed:waiter', status: 'unknown', error: 'Lost acknowledgement' }),
    ]));
    await usePrintJobs.persist.rehydrate();
    expect(await printTabletTickets(qc, cart, 'waiter-failed', 'T1-11', 'Made', false)).toBe(false);
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });
});
