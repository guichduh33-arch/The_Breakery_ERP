// apps/pos/src/features/cart/__tests__/fire-waiter-ticket.smoke.test.tsx
//
// Spec B-1 Ph1 Bloc 1.4 — à chaque fire réussi, exactement un ticket 'waiter'
// consolidé est émis avec TOUS les items non annulés (y compris dispatch 'none').

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.stubEnv('VITE_PRINT_MOCK', '1');

const rpc = vi.fn().mockResolvedValue({
  data: { order_id: 'order-w1', order_number: '#0099', idempotent_replay: false },
  error: null,
});
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

const PRINTERS_MAP = new Map([
  ['kitchen', { ip_address: '192.168.1.10', port: 9100 }],
  ['display', { ip_address: '192.168.1.11', port: 9100 }],
  ['waiter', { ip_address: '192.168.1.12', port: 9100 }],
]);

vi.mock('../hooks/useStationPrinters', () => ({
  useStationPrinters: () => ({ data: PRINTERS_MAP }),
}));

vi.mock('../hooks/useStationMap', () => {
  const STATION_MAP: Record<string, string> = {
    'p-cappuccino': 'barista',
    'p-croissant': 'none',
    'p-sandwich': 'kitchen',
  };
  return {
    useStationMap: () => ({ data: STATION_MAP }),
    getStationMap: async () => STATION_MAP,
  };
});

vi.mock('@/stores/authStore', () => ({
  useAuthStore: Object.assign(
    (sel: (s: { user: { full_name: string } }) => unknown) =>
      sel({ user: { full_name: 'Waiter-Test' } }),
    { getState: () => ({ user: { full_name: 'Waiter-Test' } }) },
  ),
}));

import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFireToStations } from '../hooks/useFireToStations';
import { useCartStore } from '@/stores/cartStore';
import { useShiftStore } from '@/stores/shiftStore';
import {
  getMockPrintBuffer,
  clearMockPrintBuffer,
} from '@/services/print/printService';
import type { StationTicketPayload } from '@/services/print/printService';

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  clearMockPrintBuffer();
  rpc.mockResolvedValue({
    data: { order_id: 'order-w1', order_number: '#0099', idempotent_replay: false },
    error: null,
  });
  useShiftStore.setState({ current: { id: 'shift-w1' } } as never);
  useCartStore.setState({
    cart: {
      items: [
        { id: 'l-cap', product_id: 'p-cappuccino', name: 'Cappuccino', unit_price: 25_000, quantity: 1, modifiers: [] },
        { id: 'l-cro', product_id: 'p-croissant', name: 'Croissant', unit_price: 15_000, quantity: 1, modifiers: [] },
        { id: 'l-san', product_id: 'p-sandwich', name: 'Sandwich', unit_price: 35_000, quantity: 1, modifiers: [] },
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

describe('useFireToStations — waiter ticket (Spec B-1 Ph1 Bloc 1.4)', () => {
  it('emits exactly one waiter ticket with all non-cancelled items (incl. dispatch none)', async () => {
    const { result } = renderHook(() => useFireToStations(), { wrapper });

    await act(async () => {
      await result.current.mutation.mutateAsync(undefined);
    });

    const buffer = getMockPrintBuffer();
    const waiterTickets = buffer.filter((e) => 'payload' in e && e.kind === 'waiter');
    expect(waiterTickets).toHaveLength(1);                        // un seul récap

    const wp = waiterTickets[0]!.payload as StationTicketPayload;
    expect(wp.role).toBe('waiter');
    expect(wp.items.map((i) => i.name).sort())
      .toEqual(['Cappuccino', 'Croissant', 'Sandwich'].sort());  // TOUS les items, même 'none'
  });
});
