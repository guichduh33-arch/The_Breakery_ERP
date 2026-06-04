// apps/pos/src/services/print/__tests__/print-server-url-config.smoke.test.tsx
//
// fix/pos-print-bridge-config — printService reads VITE_PRINT_SERVER_URL.
//
// printService.ts reads `const SERVER_URL = import.meta.env.VITE_PRINT_SERVER_URL
// ?? 'http://localhost:3001'` ONCE at module load. So each case must:
//   1. vi.stubEnv(...) the desired value (and turn VITE_PRINT_MOCK off — the
//      mock branch short-circuits before fetch),
//   2. vi.resetModules() so the const re-evaluates,
//   3. dynamically import the module,
//   4. inspect the URL passed to a mocked global fetch.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const originalFetch = globalThis.fetch;

function mockFetchOk() {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({}),
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

const PRINTER = { ip_address: '192.168.1.10', port: 9100 };

const STATION_PAYLOAD = {
  kind: 'prep' as const,
  role: 'kitchen' as const,
  order_number: 'ORD-1',
  created_at: '2026-06-01T00:00:00.000Z',
  server_name: 'Tester',
  items: [{ name: 'Omelette', quantity: 1 }],
};

const RECEIPT_PAYLOAD = {
  business: { name: 'The Breakery', address: 'Bali' },
  order: {
    order_number: 'ORD-1',
    created_at: '2026-06-01T00:00:00.000Z',
    cashier_name: 'Tester',
    order_type: 'dine_in' as const,
  },
  items: [{ name: 'Espresso', quantity: 1, unit_price: 25_000, line_total: 25_000 }],
  totals: { items_total: 25_000, redemption_amount: 0, total: 25_000, tax_amount: 0 },
  payment: { method: 'cash' as const, amount: 25_000, cash_received: 30_000, change_given: 5_000 },
};

describe('printService — VITE_PRINT_SERVER_URL', () => {
  beforeEach(() => {
    // Ensure the mock branch is OFF so fetch is actually exercised.
    vi.stubEnv('VITE_PRINT_MOCK', '');
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
    // The settings store is a module singleton — reset its printerUrl so a
    // store override set in one case can't leak into the env/fallback cases.
    const { usePosSettingsStore } = await import('@/stores/posSettingsStore');
    usePosSettingsStore.setState({ printerUrl: '' });
    vi.resetModules();
  });

  it('printStationTicket POSTs to the configured VITE_PRINT_SERVER_URL', async () => {
    vi.stubEnv('VITE_PRINT_SERVER_URL', 'http://10.0.0.9:4000');
    vi.resetModules();
    const fetchMock = mockFetchOk();

    const { printStationTicket } = await import('../printService');
    await printStationTicket(PRINTER, STATION_PAYLOAD);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe('http://10.0.0.9:4000/print/ticket');
  });

  it('printReceipt POSTs to the configured VITE_PRINT_SERVER_URL', async () => {
    vi.stubEnv('VITE_PRINT_SERVER_URL', 'http://10.0.0.9:4000');
    vi.resetModules();
    const fetchMock = mockFetchOk();

    const { printReceipt } = await import('../printService');
    await printReceipt(RECEIPT_PAYLOAD);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe('http://10.0.0.9:4000/print/receipt');
  });

  it('falls back to http://localhost:3001 when VITE_PRINT_SERVER_URL is unset', async () => {
    // No stubEnv for VITE_PRINT_SERVER_URL → undefined → fallback.
    vi.resetModules();
    const fetchMock = mockFetchOk();

    const { printStationTicket } = await import('../printService');
    await printStationTicket(PRINTER, STATION_PAYLOAD);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe('http://localhost:3001/print/ticket');
  });

  it('prefers usePosSettingsStore.printerUrl over the env var', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_PRINT_SERVER_URL', 'http://env-host:3001');
    const { usePosSettingsStore } = await import('@/stores/posSettingsStore');
    usePosSettingsStore.setState({ printerUrl: 'http://store-host:3001' });
    const fetchSpy = mockFetchOk();
    const { openCashDrawer } = await import('../printService');
    await openCashDrawer();
    const calledUrl = String(fetchSpy.mock.calls[0]?.[0] ?? '');
    expect(calledUrl).toContain('store-host');
    expect(calledUrl).not.toContain('env-host');
  });
});
