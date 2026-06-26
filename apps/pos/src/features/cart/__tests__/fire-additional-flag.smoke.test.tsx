// apps/pos/src/features/cart/__tests__/fire-additional-flag.smoke.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Force the print service mock buffer (VITE_PRINT_MOCK path).
vi.stubEnv('VITE_PRINT_MOCK', '1');

const rpc = vi.fn().mockResolvedValue({
  data: { order_id: 'order-1', order_number: '#0001', idempotent_replay: false }, error: null,
});
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock('../hooks/useStationPrinters', () => ({
  useStationPrinters: () => ({ data: new Map([['barista', { ip_address: '1.1.1.1', port: 9100 }]]) }),
}));
vi.mock('../hooks/useStationMap', () => ({
  useStationMap: () => ({ data: { p1: ['barista'] } }),
  getStationMap: async () => ({ p1: ['barista'] }),
}));

import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFireToStations } from '../hooks/useFireToStations';
import { useCartStore } from '@/stores/cartStore';
import { useShiftStore } from '@/stores/shiftStore';
import { getMockPrintBuffer, clearMockPrintBuffer } from '@/services/print/printService';

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  clearMockPrintBuffer();
  useShiftStore.setState({ current: { id: 'shift-1' } } as never);
  useCartStore.setState({
    cart: { items: [{ id: 'l1', product_id: 'p1', name: 'Latte', unit_price: 30000, quantity: 1, modifiers: [] }], order_type: 'dine_in' },
    lockedItemIds: [], printedItemIds: [], attachedCustomer: null,
    pickedUpOrderId: 'order-1', // already reopened → this fire is an append
    appliedPromotions: [], dismissedPromotionIds: new Set(), isOffline: false,
  } as never);
});

describe('useFireToStations — additional flag', () => {
  it('marks the station ticket additional when appending to a reopened order', async () => {
    const { result } = renderHook(() => useFireToStations(), { wrapper });
    await act(async () => { await result.current.mutation.mutateAsync(undefined); });
    const stationEntries = getMockPrintBuffer().filter((e) => e.kind === 'prep');
    expect(stationEntries.length).toBeGreaterThan(0);
    expect(stationEntries.every((e) => (e.payload as { additional?: boolean }).additional === true)).toBe(true);
  });

  it('does NOT mark the ticket additional on a first-phase fire (pickedUpOrderId null)', async () => {
    // First-phase fire: no existing order on the terminal → the RPC mints a new
    // order. The phase-1 ticket must NOT carry the ADDITIONAL ORDER flag.
    useCartStore.setState((s) => ({ ...s, pickedUpOrderId: null }) as never);
    const { result } = renderHook(() => useFireToStations(), { wrapper });
    await act(async () => { await result.current.mutation.mutateAsync(undefined); });
    const stationEntries = getMockPrintBuffer().filter((e) => e.kind === 'prep');
    expect(stationEntries.length).toBeGreaterThan(0);
    expect(stationEntries.every((e) => !(e.payload as { additional?: boolean }).additional)).toBe(true);
  });
});
