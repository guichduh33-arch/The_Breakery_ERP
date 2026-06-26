// apps/pos/src/features/cart/__tests__/fire-multi-station.smoke.test.tsx
//
// Spec B-1 Ph2 Task 9 TDD — un produit multi-station (dispatch_stations:
// ['kitchen','display']) doit produire 2 StationFireResult distincts (un KOT
// par station). Le même item apparaît dans chaque bucket.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.stubEnv('VITE_PRINT_MOCK', '1');

const PID = 'p-sandwich-multi';

const rpc = vi.fn().mockResolvedValue({
  data: { order_id: 'ord-ms-1', order_number: '#0111', idempotent_replay: false },
  error: null,
});

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a) },
}));

const PRINTERS_MAP = new Map([
  ['kitchen', { ip_address: '10.0.0.1', port: 9100 }],
  ['display', { ip_address: '10.0.0.2', port: 9100 }],
]);

vi.mock('../hooks/useStationPrinters', () => ({
  useStationPrinters: () => ({ data: PRINTERS_MAP }),
}));

vi.mock('../hooks/useStationMap', () => ({
  useStationMap: () => ({ data: { [PID]: ['kitchen', 'display'] } }),
  getStationMap: async () => ({ [PID]: ['kitchen', 'display'] }),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: Object.assign(
    (sel: (s: { user: { full_name: string } }) => unknown) =>
      sel({ user: { full_name: 'Chef' } }),
    { getState: () => ({ user: { full_name: 'Chef' } }) },
  ),
}));

import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { StationFireResult } from '../hooks/useFireToStations';
import { useFireToStations } from '../hooks/useFireToStations';
import { useCartStore } from '@/stores/cartStore';
import { useShiftStore } from '@/stores/shiftStore';
import { clearMockPrintBuffer } from '@/services/print/printService';

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  clearMockPrintBuffer();
  rpc.mockResolvedValue({
    data: { order_id: 'ord-ms-1', order_number: '#0111', idempotent_replay: false },
    error: null,
  });
  useShiftStore.setState({ current: { id: 'shift-ms-1' } } as never);
  useCartStore.setState({
    cart: {
      items: [
        { id: 'l-ms', product_id: PID, name: 'Sandwich', unit_price: 40_000, quantity: 1, modifiers: [] },
      ],
      order_type: 'dine_in',
    },
    printedItemIds: [],
    lockedItemIds: [],
    attachedCustomer: null,
    pickedUpOrderId: null,
    appliedPromotions: [],
    dismissedPromotionIds: new Set<string>(),
    isOffline: false,
  } as never);
});

describe('useFireToStations — multi-station dispatch (Spec B-1 Ph2 Task 9)', () => {
  it('fires to BOTH kitchen and display for a product routed to [kitchen, display]', async () => {
    const { result } = renderHook(() => useFireToStations(), { wrapper });

    // firableCount must see the product as firable (has a prep station in its array).
    expect(result.current.firableCount).toBe(1);

    let results: StationFireResult[] = [];
    await act(async () => {
      results = await result.current.mutation.mutateAsync(undefined);
    });

    const roles = results.map((r) => r.role).sort();
    expect(roles).toEqual(['display', 'kitchen']);

    // Each station result contains the same item id.
    for (const r of results) {
      expect(r.itemIds).toContain('l-ms');
    }
  });
});
