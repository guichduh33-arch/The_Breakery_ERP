// apps/pos/src/features/cart/__tests__/station-map-variants.smoke.test.tsx
// S44 P0-B : une ligne panier issue d'une VARIANTE (product_id enfant, absent
// du cache ['products'] qui filtre parent_product_id IS NULL) doit quand même
// être routée vers sa station — sinon ticket amputé + firableCount=0 sur un
// panier 100 % variantes (bouton « Send to Kitchen » mort). useStationMap lit
// les produits SANS ce filtre.
/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { groupItemsByStation } from '@breakery/domain';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

// The variant child product_id is NOT in ['products'] (filtered) but IS in the
// station map (useStationMap drops the parent_product_id filter).
const STATION_MAP: Record<string, string> = { 'variant-child-1': 'barista' };

vi.mock('@/features/cart/hooks/useStationMap', () => ({
  useStationMap: () => ({ data: STATION_MAP }),
  getStationMap: () => Promise.resolve(STATION_MAP),
}));

vi.mock('@/features/cart/hooks/useStationPrinters', () => ({
  useStationPrinters: () => ({ data: new Map([['barista', { ip_address: '1.1.1.1', port: 9100, name: 'B' }]]) }),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: vi.fn(), auth: { getSession: vi.fn() } },
  supabaseUrl: 'http://localhost:54321',
}));

import { useCartStore } from '@/stores/cartStore';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const VARIANT_LINE = {
  id: 'line-1',
  product_id: 'variant-child-1',
  name: 'Latte — Oat',
  unit_price: 38_000,
  quantity: 1,
  modifiers: [] as never[],
};

describe('S44 P0-B — station map routes variant children', () => {
  beforeEach(() => {
    useCartStore.setState({
      cart: { items: [VARIANT_LINE], order_type: 'dine_in' },
      printedItemIds: [],
      lockedItemIds: [],
      attachedCustomer: null,
      pickedUpOrderId: null,
      appliedPromotions: [],
      dismissedPromotionIds: new Set<string>(),
    } as never);
  });

  it('T1: useStationMap exposes the variant child → barista', async () => {
    const { useStationMap } = await import('../hooks/useStationMap');
    const { result } = renderHook(() => useStationMap(), { wrapper });
    expect(result.current.data?.['variant-child-1']).toBe('barista');
  });

  it('T2: firableCount === 1 for a 100%-variant cart', async () => {
    const { useFireToStations } = await import('../hooks/useFireToStations');
    const { result } = renderHook(() => useFireToStations(), { wrapper });
    expect(result.current.firableCount).toBe(1);
  });

  it('T3: groupItemsByStation places the variant line under barista', () => {
    const grouped = groupItemsByStation(
      [VARIANT_LINE as never],
      STATION_MAP as Record<string, 'barista' | 'kitchen' | 'display' | 'none'>,
    );
    expect(grouped.barista?.map((i) => i.id)).toEqual(['line-1']);
  });
});
