import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { TabletCart, StationTicketPayload } from '@breakery/domain';
import { printTabletTickets } from '../hooks/printTabletTickets';
import { usePrintJobs } from '@/services/print/printJobs';
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
    expect(await printTabletTickets(new QueryClient(), cart, 'send-3', 'L-3', 'Waiter', false)).toBe(false);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('respects stations deliberately configured without paper', async () => {
    mocks.copies.mockResolvedValue({ kitchen: 0, barista: 2, display: 1 });
    expect(await printTabletTickets(new QueryClient(), cart, 'send-4', 'T1-8', 'Waiter', false)).toBe(true);
    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(mocks.send.mock.calls.every((call) => (call[1] as StationTicketPayload).role === 'barista')).toBe(true);
  });
});
